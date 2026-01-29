# @yespark/slack-mcp-server

Serveur MCP pour Slack, sécurisé pour une utilisation avec des assistants IA.

> **Sécurité** : Les DMs et group DMs sont **bloqués** pour protéger les conversations privées.

## Installation

```bash
npm install @yespark/slack-mcp-server
```

## Configuration MCP

```json
{
  "mcpServers": {
    "slack": {
      "command": "npx",
      "args": ["@yespark/slack-mcp-server"],
      "env": {
        "SLACK_TOKEN": "xoxp-..."
      }
    }
  }
}
```

### Variables d'environnement

| Variable | Requis | Description |
|----------|--------|-------------|
| `SLACK_TOKEN` | Oui | Token OAuth utilisateur (`xoxp-...`) |
| `SLACK_MCP_ADD_MESSAGE_TOOL` | Non | `true` pour activer l'envoi de messages, ou liste de channel IDs |

## Outils disponibles

| Outil | Description |
|-------|-------------|
| `channels_list` | Liste les channels (public + privé) |
| `conversations_history` | Messages d'un channel |
| `conversations_replies` | Réponses d'un thread |
| `conversations_search` | Recherche de messages |
| `conversations_add_message` | Poster un message (désactivé par défaut) |

## Ressources

| URI | Description |
|-----|-------------|
| `slack://{workspace}/channels` | Répertoire des channels (CSV) |
| `slack://{workspace}/users` | Répertoire des utilisateurs (CSV) |

## Restrictions de sécurité

| Fonctionnalité | Statut |
|----------------|--------|
| DMs (`@user`, `D...`) | ❌ Bloqué |
| Group DMs (MPIM) | ❌ Bloqué |
| Channels publics | ✅ Autorisé |
| Channels privés | ✅ Autorisé |

## Développement

```bash
npm install
npm run build
npm run inspector  # Debug avec MCP Inspector
```

## Licence

MIT
