/**
 * Janua OAuth2 Authentication Routes
 * Handles OAuth2 Authorization Code Flow with Janua SSO
 */

import express from 'express';
import crypto from 'crypto';
import januaClient from '../utils/janua-client.js';
import { generateToken } from '../middleware/auth.js';
import { userDb } from '../database/db.js';

const router = express.Router();

// Store OAuth2 state for CSRF protection (in production, use Redis)
const oauthStates = new Map();

/**
 * Initiate OAuth2 login flow
 * Redirects user to Janua authorization endpoint
 */
router.get('/login', (req, res) => {
  if (!januaClient.isConfigured()) {
    return res.status(500).json({
      error: 'Janua OAuth2 not configured',
      hint: 'Set JANUA_CLIENT_ID and JANUA_CLIENT_SECRET environment variables'
    });
  }

  // Generate CSRF protection state
  const state = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  // Store state with expiration
  oauthStates.set(state, { expiresAt });

  // Redirect to Janua authorization endpoint
  const authUrl = januaClient.getAuthorizationUrl(state);
  res.redirect(authUrl);
});

/**
 * OAuth2 callback handler
 * Receives authorization code from Janua and exchanges it for tokens
 */
router.get('/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  // Handle authorization errors
  if (error) {
    console.error('OAuth2 authorization error:', error, error_description);
    return res.redirect(`/?error=${encodeURIComponent(error_description || error)}`);
  }

  // Validate required parameters
  if (!code || !state) {
    return res.redirect('/?error=missing_parameters');
  }

  // Verify CSRF state
  const storedState = oauthStates.get(state);
  if (!storedState) {
    return res.redirect('/?error=invalid_state');
  }

  // Check state expiration
  if (Date.now() > storedState.expiresAt) {
    oauthStates.delete(state);
    return res.redirect('/?error=state_expired');
  }

  // Clean up used state
  oauthStates.delete(state);

  try {
    // Exchange authorization code for tokens
    const tokenResponse = await januaClient.exchangeCodeForToken(code);
    const { access_token, id_token } = tokenResponse;

    // Get user information from Janua
    const userInfo = await januaClient.getUserInfo(access_token);

    // Email whitelist validation - only allow authorized users
    // Configure via JANUA_ALLOWED_EMAILS env var (comma-separated) or default to admin@madfam.io
    const allowedEmails = (process.env.JANUA_ALLOWED_EMAILS || 'admin@madfam.io')
      .split(',')
      .map(email => email.trim().toLowerCase());

    const userEmail = (userInfo.email || '').toLowerCase();

    if (!allowedEmails.includes(userEmail)) {
      console.warn(`[Janua Auth] Access denied for email: ${userEmail}. Allowed: ${allowedEmails.join(', ')}`);
      return res.redirect(`/?error=${encodeURIComponent('Access denied. Your email is not authorized to use this application.')}`);
    }

    console.log(`[Janua Auth] Access granted for authorized user: ${userEmail}`);

    // Create or update user in local database
    let user = userDb.getUserByUsername(userInfo.sub); // Use Janua user ID as username

    if (!user) {
      // Create new user if doesn't exist
      // Note: We don't store passwords for OAuth users
      user = userDb.createUser(userInfo.sub, null, {
        email: userInfo.email,
        name: userInfo.name,
        oauth_provider: 'janua',
        oauth_user_id: userInfo.sub
      });
      console.log(`[Janua Auth] Created new user: ${userInfo.sub} (${userInfo.email})`);
    } else {
      // Update last login
      userDb.updateLastLogin(user.id);
    }

    // Generate JWT token for session management
    const sessionToken = generateToken(user);

    // Redirect to frontend with token
    // In production, consider using secure HTTP-only cookies instead
    res.redirect(`/?token=${sessionToken}&oauth=janua`);

  } catch (error) {
    console.error('OAuth2 callback error:', error);
    res.redirect(`/?error=${encodeURIComponent(error.message)}`);
  }
});

/**
 * OAuth2 logout
 * Revokes tokens and clears session
 */
router.post('/logout', async (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token && januaClient.isConfigured()) {
    try {
      // Revoke token with Janua
      await januaClient.revokeToken(token);
    } catch (error) {
      console.error('Token revocation error:', error);
      // Continue with logout even if revocation fails
    }
  }

  res.json({ success: true, message: 'Logged out successfully' });
});

/**
 * Check OAuth2 configuration status
 */
router.get('/status', (req, res) => {
  res.json({
    oauth_enabled: januaClient.isConfigured(),
    oauth_provider: 'janua',
    janua_url: januaClient.januaUrl
  });
});

export default router;
