# ClaudeCodeUI Kubernetes Resources

## Secrets Setup

Before deploying ClaudeCodeUI, you must create the secrets in Kubernetes.

### Quick Setup

```bash
# Connect to the cluster (establish SSH tunnel first if needed)
# ssh -L 55323:localhost:6443 foundry-core

# Create the secret
kubectl create secret generic claudecodeui-secrets \
  --from-literal=jwt-secret="$(openssl rand -base64 48)" \
  --from-literal=janua-client-secret='jns_3SRnFv5IF32bM3fkHH5bFQ3su9LlLJB3zqlvKbwIVdnqJ5paKc4u7DfMhg10ZTsc' \
  -n madfam-automation
```

### Manual Setup

1. Copy the template:
   ```bash
   cp k8s/secrets.template.yaml k8s/secrets.yaml
   ```

2. Edit `k8s/secrets.yaml` and replace:
   - `jwt-secret`: Generate with `openssl rand -base64 48`
   - `janua-client-secret`: Use the value from `.env.example` or Janua admin

3. Apply to cluster:
   ```bash
   kubectl apply -f k8s/secrets.yaml
   ```

## Required Secrets

| Key | Description | How to Get |
|-----|-------------|------------|
| `jwt-secret` | Session token signing key | `openssl rand -base64 48` |
| `janua-client-secret` | Janua OAuth2 client secret | From Janua admin panel |

## OAuth2 Client Details

- **Client ID**: `jnc_lSGMbQtCGdHSctd4mEQoaklLBCv7xXhe`
- **Redirect URI**: `https://agents.madfam.io/auth/callback`
- **Allowed Email**: `admin@madfam.io`

## Deployment

After secrets are created, deploy with:

```bash
# From claudecodeui repo
enclii deploy

# Or rebuild and deploy
docker build -t ghcr.io/madfam-org/claudecodeui:latest .
docker push ghcr.io/madfam-org/claudecodeui:latest
kubectl rollout restart deployment/claudecodeui -n madfam-automation
```
