/**
 * Janua OAuth2 Client
 * Handles OAuth2 Authorization Code Flow with Janua SSO
 */

import fetch from 'node-fetch';

class JanuaClient {
  constructor() {
    this.januaUrl = process.env.JANUA_URL || 'https://auth.madfam.io';
    this.clientId = process.env.JANUA_CLIENT_ID;
    this.clientSecret = process.env.JANUA_CLIENT_SECRET;
    this.redirectUri = process.env.JANUA_REDIRECT_URI || 'https://agents.madfam.io/auth/callback';

    if (!this.clientId || !this.clientSecret) {
      console.warn('⚠️  Janua OAuth2 not configured. Set JANUA_CLIENT_ID and JANUA_CLIENT_SECRET environment variables.');
    }
  }

  /**
   * Get OAuth2 authorization URL
   * @param {string} state - CSRF protection state parameter
   * @returns {string} Authorization URL
   */
  getAuthorizationUrl(state) {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid profile email agent:view agent:control',
      state: state
    });

    return `${this.januaUrl}/api/v1/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   * @param {string} code - Authorization code from callback
   * @returns {Promise<Object>} Token response with access_token, id_token, etc.
   */
  async exchangeCodeForToken(code) {
    const response = await fetch(`${this.januaUrl}/api/v1/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: this.redirectUri
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return response.json();
  }

  /**
   * Get user info from Janua
   * @param {string} accessToken - Access token
   * @returns {Promise<Object>} User information
   */
  async getUserInfo(accessToken) {
    const response = await fetch(`${this.januaUrl}/api/v1/oauth/userinfo`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get user info: ${error}`);
    }

    return response.json();
  }

  /**
   * Revoke token
   * @param {string} token - Token to revoke
   * @returns {Promise<void>}
   */
  async revokeToken(token) {
    await fetch(`${this.januaUrl}/api/v1/oauth/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`
      },
      body: new URLSearchParams({
        token: token,
        token_type_hint: 'access_token'
      })
    });
  }

  /**
   * Check if Janua OAuth2 is configured
   * @returns {boolean}
   */
  isConfigured() {
    return !!(this.clientId && this.clientSecret);
  }
}

export default new JanuaClient();
