# Janua SSO Integration Guide

This document describes the Janua OAuth2/OIDC integration added to ClaudeCodeUI for enterprise authentication and Auto-Claude agent management.

## Overview

ClaudeCodeUI now supports **dual authentication modes**:

1. **Simple Auth** (OSS default): Username/password with local JWT tokens
2. **Janua OAuth2** (Enterprise): Federated SSO with RS256 JWT tokens from Janua

Both modes can coexist, allowing flexible deployment for different environments.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ USER (Browser)                                               │
└─────────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ ClaudeCodeUI (https://agents.madfam.io)                     │
│ • OAuth2 login redirects to Janua                           │
│ • Receives callback with authorization code                 │
│ • Exchanges code for access_token + id_token                │
│ • Creates local session with JWT                            │
└─────────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ Janua SSO (https://auth.madfam.io)                          │
│ • OAuth2/OIDC provider                                      │
│ • Issues RS256 JWT tokens                                   │
│ • JWKS endpoint for public key verification                 │
└─────────────────────────────────────────────────────────────┘
                       ↓
┌─────────────────────────────────────────────────────────────┐
│ Auto-Claude Agents (Kubernetes)                             │
│ • Discovered via K8s API                                    │
│ • Task submission via Redis queues                          │
│ • Requires `agent:control` scope                            │
└─────────────────────────────────────────────────────────────┘
```

## New Features

### 1. Janua OAuth2 Authentication

**Files Added:**
- `server/routes/janua-auth.js` - OAuth2 flow endpoints
- `server/middleware/janua-auth.js` - JWT verification against Janua JWKS
- `server/utils/janua-client.js` - Janua OAuth2 client wrapper

**Endpoints:**
- `GET /api/janua-auth/login` - Initiate OAuth2 flow (redirect to Janua)
- `GET /api/janua-auth/callback` - OAuth2 callback handler (exchange code for tokens)
- `POST /api/janua-auth/logout` - Revoke tokens and clear session
- `GET /api/janua-auth/status` - Check OAuth2 configuration status

**OAuth2 Scopes:**
- `openid` - OpenID Connect authentication
- `profile` - User profile information
- `email` - User email address
- `agent:view` - View Auto-Claude agent status
- `agent:control` - Control agents (submit tasks, view logs)

### 2. Agent Discovery Service

**File:** `server/services/agentDiscoveryService.js`

Discovers Auto-Claude agent pods from Kubernetes API and enriches them with Redis state.

**Functions:**
- `discoverAgents()` - Get all agent pods with K8s + Redis state
- `getAgentDetails(agentId)` - Get detailed info for specific agent
- `getAgentLogs(agentId, containerName, tailLines)` - Stream agent logs
- `isAgentDiscoveryAvailable()` - Check if K8s + Redis are accessible

**Example:**
```javascript
import { discoverAgents } from './services/agentDiscoveryService.js';

const agents = await discoverAgents();
// Returns:
// [
//   {
//     id: "auto-claude-agent-abc123",
//     status: "ready",
//     agentStatus: "idle",
//     currentTask: null,
//     metrics: { tasksCompleted: 15, tasksFailed: 2 }
//   }
// ]
```

### 3. Task Submission Service

**File:** `server/services/taskSubmissionService.js`

Manages task queue for Auto-Claude agents via Redis priority queues.

**Functions:**
- `submitTask(taskSpec, userId)` - Submit task to agent queue
- `getTaskDetails(taskId)` - Get task status and results
- `getUserTasks(userId)` - Get all tasks for a user
- `getQueueStats()` - Get queue statistics (pending, active, completed, failed)
- `cancelTask(taskId, userId)` - Cancel pending task
- `parseNaturalLanguageInstruction(instruction)` - Parse NL to task spec

**Example:**
```javascript
import { submitTask } from './services/taskSubmissionService.js';

const result = await submitTask({
  instruction: "Fix authentication bug in login.ts line 45",
  repository: "janua",
  branch: "main",
  priority: 2,  // 1=critical, 2=high, 3=normal, 4=low, 5=very low
  context: {
    files: ["src/auth/login.ts"],
    issueUrl: "https://github.com/madfam-io/janua/issues/123"
  }
}, userId);

// Returns:
// {
//   taskId: "task-abc123",
//   status: "pending",
//   queuePosition: 3,
//   estimatedWaitTime: 1800  // seconds
// }
```

## Configuration

### Environment Variables

Add these to your `.env` file:

```bash
# Janua OAuth2 Configuration
JANUA_URL=https://auth.madfam.io
JANUA_CLIENT_ID=jnc_2kEE7mGL6b8T2GbA1ilHD1KR5NqKeScp
JANUA_CLIENT_SECRET=<your-client-secret>
JANUA_REDIRECT_URI=https://agents.madfam.io/auth/callback

# Kubernetes Configuration (for agent discovery)
KUBERNETES_NAMESPACE=madfam-automation
IN_CLUSTER=true  # Set to false for local development

# Redis Configuration (for task queues and agent state)
REDIS_URL=redis://auto-claude-redis.madfam-automation.svc.cluster.local:6379

# Auto-Claude Agent API (optional, for direct API calls)
AGENT_API_URL=http://auto-claude-agent.madfam-automation.svc.cluster.local:8080
```

### OAuth2 Client Setup

The OAuth2 client has already been created in Janua with these credentials:

**Client ID:** `jnc_2kEE7mGL6b8T2GbA1ilHD1KR5NqKeScp`
**Client Secret:** (stored in Kubernetes secret `claudecodeui-secrets`)
**Redirect URIs:**
- Production: `https://agents.madfam.io/auth/callback`
- Development: `http://localhost:3001/auth/callback`

**Scopes:** `openid profile email agent:view agent:control`

## Installation

1. **Install new dependencies:**
   ```bash
   npm install
   ```

   New packages added:
   - `jose@^5.2.0` - JWKS verification for Janua JWT tokens
   - `@kubernetes/client-node@^0.20.0` - Kubernetes API client
   - `redis@^4.6.12` - Redis client for task queues

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your Janua credentials
   ```

3. **Run the application:**
   ```bash
   npm run dev
   ```

## Usage

### Development Mode (Simple Auth)

For local development without Janua:

```bash
# Don't set JANUA_CLIENT_ID and JANUA_CLIENT_SECRET
npm run dev
```

Visit `http://localhost:3001` and use the standard login form.

### Production Mode (Janua OAuth2)

For production with Janua SSO:

```bash
# Set Janua environment variables
export JANUA_CLIENT_ID=jnc_2kEE7mGL6b8T2GbA1ilHD1KR5NqKeScp
export JANUA_CLIENT_SECRET=<your-client-secret>
export JANUA_URL=https://auth.madfam.io
npm start
```

Visit `https://agents.madfam.io/api/janua-auth/login` to initiate OAuth2 flow.

### Frontend Integration

Update your frontend to detect and use Janua OAuth2:

```javascript
// Check if Janua OAuth2 is available
const response = await fetch('/api/janua-auth/status');
const { oauth_enabled } = await response.json();

if (oauth_enabled) {
  // Redirect to Janua OAuth2 login
  window.location.href = '/api/janua-auth/login';
} else {
  // Use traditional username/password login
  // ... existing login code ...
}
```

## API Routes

### Authentication Routes

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/janua-auth/login` | Initiate OAuth2 flow | No |
| GET | `/api/janua-auth/callback` | OAuth2 callback handler | No |
| POST | `/api/janua-auth/logout` | Revoke tokens and logout | Yes |
| GET | `/api/janua-auth/status` | Check OAuth2 config | No |

### Agent Management Routes (New - To Be Added)

These routes should be added to `server/index.js`:

| Method | Endpoint | Description | Auth Required | Scope Required |
|--------|----------|-------------|---------------|----------------|
| GET | `/api/agents` | List all agents | Yes | `agent:view` |
| GET | `/api/agents/:id` | Get agent details | Yes | `agent:view` |
| GET | `/api/agents/:id/logs` | Stream agent logs | Yes | `agent:view` |
| POST | `/api/tasks` | Submit new task | Yes | `agent:control` |
| GET | `/api/tasks/:id` | Get task details | Yes | `agent:view` |
| GET | `/api/tasks/user/:userId` | Get user's tasks | Yes | `agent:view` |
| DELETE | `/api/tasks/:id` | Cancel task | Yes | `agent:control` |
| GET | `/api/queue/stats` | Get queue statistics | Yes | `agent:view` |

## Middleware Usage

### Protect Routes with Janua JWT

```javascript
import { authenticateJanuaToken, requireScope } from './middleware/janua-auth.js';

// Require valid Janua JWT token
router.get('/api/agents', authenticateJanuaToken, async (req, res) => {
  // req.user contains { id, username, email, name, scopes }
  const agents = await discoverAgents();
  res.json({ agents });
});

// Require specific OAuth2 scope
router.post('/api/tasks', authenticateJanuaToken, requireScope('agent:control'), async (req, res) => {
  const result = await submitTask(req.body, req.user.id);
  res.json(result);
});
```

### Flexible Authentication (Janua or Local JWT)

```javascript
import { authenticateFlexible } from './middleware/janua-auth.js';

// Accept either Janua JWT or local JWT
router.get('/api/profile', authenticateFlexible, (req, res) => {
  res.json({ user: req.user });
});
```

## Security Considerations

1. **CSRF Protection**: OAuth2 state parameter prevents CSRF attacks
2. **Token Verification**: JWT tokens verified against Janua JWKS (RS256)
3. **Scope Enforcement**: `requireScope()` middleware validates OAuth2 scopes
4. **HTTPS Only**: OAuth2 flow requires HTTPS in production
5. **Token Revocation**: Logout revokes tokens with Janua
6. **Session Management**: Consider using Redis for session storage in production

## Testing

### Test OAuth2 Flow

```bash
# 1. Get authorization URL
curl http://localhost:3001/api/janua-auth/status

# 2. Open authorization URL in browser
# 3. Login with Janua credentials
# 4. You'll be redirected to callback with token

# 5. Test authenticated request
curl -H "Authorization: Bearer <token>" \
  http://localhost:3001/api/agents
```

### Test Task Submission

```javascript
const response = await fetch('/api/tasks', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    instruction: "Fix authentication bug in janua login.ts",
    repository: "janua",
    priority: 2
  })
});

const { taskId, queuePosition } = await response.json();
console.log(`Task ${taskId} submitted, position ${queuePosition} in queue`);
```

## Troubleshooting

### OAuth2 Not Working

**Problem:** OAuth2 login fails with "not configured"
**Solution:** Set `JANUA_CLIENT_ID` and `JANUA_CLIENT_SECRET` environment variables

### Agent Discovery Fails

**Problem:** `/api/agents` returns empty array or error
**Solution:**
- Check `KUBERNETES_NAMESPACE` is correct
- Verify agent pods have label `app=auto-claude-agent`
- Check K8s credentials: `kubectl get pods -n madfam-automation`

### Task Submission Fails

**Problem:** Task submission returns 500 error
**Solution:**
- Verify Redis is accessible: `redis-cli -u $REDIS_URL ping`
- Check Redis URL format: `redis://host:port` or `redis://user:pass@host:port`

### JWT Verification Fails

**Problem:** API returns "Invalid or expired token"
**Solution:**
- Verify Janua JWKS is accessible: `curl https://auth.madfam.io/.well-known/jwks.json`
- Check token expiration: `echo $TOKEN | cut -d. -f2 | base64 -d | jq .exp`
- Verify `JANUA_CLIENT_ID` matches token audience

## Migration from Simple Auth

Existing users with simple auth can continue using their accounts. To migrate:

1. **Keep both auth systems:** Simple auth remains as fallback
2. **Add OAuth2 button:** Add "Login with Janua" option in UI
3. **Link accounts:** Match Janua users to existing accounts by email
4. **Gradual rollout:** Enable OAuth2 for specific users/teams first

## Next Steps

1. **Add Agent Management UI:** Build frontend components for agent list, task submission, queue monitoring
2. **WebSocket Updates:** Implement real-time task status updates via WebSocket
3. **Advanced Task Scheduling:** Add cron-like scheduling for recurring tasks
4. **Task Templates:** Create reusable task templates for common operations
5. **Metrics Dashboard:** Visualize agent performance, queue depth, task success rates

## Support

For issues or questions:
- **Janua Documentation:** https://docs.madfam.io/janua
- **Auto-Claude Documentation:** https://github.com/AndyMik90/Auto-Claude
- **Support:** support@madfam.io
