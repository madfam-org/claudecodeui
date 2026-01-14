import jwt from 'jsonwebtoken';
import { userDb } from '../database/db.js';

// JWT Configuration
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_EXPIRATION = process.env.JWT_EXPIRATION || '8h'; // Match Janua's 8-hour window

// Get JWT secret from environment - REQUIRED in production
const JWT_SECRET = process.env.JWT_SECRET || (NODE_ENV === 'production' ? null : 'claude-ui-dev-secret-change-in-production');

// Fail fast in production if JWT_SECRET not set
if (NODE_ENV === 'production' && !JWT_SECRET) {
  console.error('FATAL: JWT_SECRET must be set in production environment');
  process.exit(1);
}

// Optional API key middleware
const validateApiKey = (req, res, next) => {
  // Skip API key validation if not configured
  if (!process.env.API_KEY) {
    return next();
  }
  
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

// JWT authentication middleware
const authenticateToken = async (req, res, next) => {
  // Platform mode: use single database user (with safeguards)
  // SECURITY: Platform mode should only be used in controlled environments
  if (process.env.VITE_IS_PLATFORM === 'true') {
    // Safeguard: Require explicit opt-in for production platform mode
    if (NODE_ENV === 'production' && process.env.ALLOW_PLATFORM_MODE !== 'true') {
      console.warn('Platform mode attempted in production without ALLOW_PLATFORM_MODE=true');
      return res.status(403).json({
        error: 'Platform mode is disabled in production. Set ALLOW_PLATFORM_MODE=true to enable.'
      });
    }

    try {
      const user = userDb.getFirstUser();
      if (!user) {
        return res.status(500).json({ error: 'Platform mode: No user found in database' });
      }
      req.user = user;
      return next();
    } catch (error) {
      console.error('Platform mode error:', error);
      return res.status(500).json({ error: 'Platform mode: Failed to fetch user' });
    }
  }

  // Normal OSS JWT validation
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Verify user still exists and is active
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'Invalid token. User not found.' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Generate JWT token with expiration (matches Janua's 8-hour window)
const generateToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRATION }
  );
};

// WebSocket authentication function
const authenticateWebSocket = (token) => {
  // Platform mode: bypass token validation, return first user (with safeguards)
  if (process.env.VITE_IS_PLATFORM === 'true') {
    // Safeguard: Require explicit opt-in for production platform mode
    if (NODE_ENV === 'production' && process.env.ALLOW_PLATFORM_MODE !== 'true') {
      console.warn('WebSocket platform mode attempted in production without ALLOW_PLATFORM_MODE=true');
      return null;
    }

    try {
      const user = userDb.getFirstUser();
      if (user) {
        return { userId: user.id, username: user.username };
      }
      return null;
    } catch (error) {
      console.error('Platform mode WebSocket error:', error);
      return null;
    }
  }

  // Normal OSS JWT validation
  if (!token) {
    return null;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded;
  } catch (error) {
    console.error('WebSocket token verification error:', error);
    return null;
  }
};

export {
  validateApiKey,
  authenticateToken,
  generateToken,
  authenticateWebSocket,
  JWT_SECRET
};