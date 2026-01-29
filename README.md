# yespark-slack-mcp-server

Serveur MCP pour Slack, sécurisé pour une utilisation avec des assistants IA.

> **Sécurité** : Les DMs et group DMs sont **bloqués** pour protéger les conversations privées.

## Installation

```bash
npm install yespark-slack-mcp-server
```

## Configuration MCP

```json
{
  "mcpServers": {
    "slack": {
      "command": "npx",
      "args": ["yespark-slack-mcp-server"],
      "env": {
        "SLACK_MCP_XOXC_TOKEN": "xoxc-...",
        "SLACK_MCP_XOXD_TOKEN": "xoxd-..."
      }
    }
  }
}
```

## Authentification

### Option 1 : Tokens du navigateur (recommandé)

1. Ouvre Slack **dans ton navigateur** (pas l'app desktop)
2. Ouvre la console développeur (F12)

**Récupérer `SLACK_MCP_XOXC_TOKEN` :**
```javascript
JSON.parse(localStorage.localConfig_v2).teams[document.location.pathname.match(/^\/client\/([A-Z0-9]+)/)[1]].token
```

**Récupérer `SLACK_MCP_XOXD_TOKEN` :**
- Onglet **Application** → **Cookies**
- Copie la valeur du cookie nommé `d`

### Option 2 : OAuth Token (xoxp)

1. Crée une app sur https://api.slack.com/apps
2. Ajoute les scopes : `channels:read`, `channels:history`, `groups:read`, `groups:history`, `users:read`, `search:read`, `chat:write`
3. Installe l'app et copie le **User OAuth Token** (`xoxp-...`)

```json
{
  "env": {
    "SLACK_TOKEN": "xoxp-..."
  }
}
```

## Variables d'environnement

| Variable | Description |
|----------|-------------|
| `SLACK_MCP_XOXC_TOKEN` | Token browser (xoxc-...) |
| `SLACK_MCP_XOXD_TOKEN` | Cookie browser (xoxd-...) |
| `SLACK_TOKEN` | Alternative : OAuth token (xoxp-...) |
| `SLACK_MCP_ADD_MESSAGE_TOOL` | `true` ou liste de channel IDs pour activer l'envoi |

## Outils disponibles

| Outil | Description |
|-------|-------------|
| `channels_list` | Liste les channels (public + privé) |
| `conversations_history` | Messages d'un channel |
| `conversations_replies` | Réponses d'un thread |
| `conversations_search` | Recherche de messages |
| `conversations_add_message` | Poster un message (désactivé par défaut) |

## Restrictions de sécurité

| Fonctionnalité | Statut |
|----------------|--------|
| DMs (`@user`, `D...`) | ❌ Bloqué |
| Group DMs (MPIM) | ❌ Bloqué |
| Channels publics | ✅ Autorisé |
| Channels privés | ✅ Autorisé |

## Licence

MIT
