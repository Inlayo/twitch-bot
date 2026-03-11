# Twitch Live Notifier Bot

A Discord bot that monitors Twitch streamers and sends notifications to designated Discord channels when they go live.

## Features

- Real-time Twitch live status monitoring
- Automatic Discord notifications with stream thumbnails
- Per-channel streamer management
- Supports multiple Discord channels
- Automatic streamer username change detection
- PM2 compatible for production deployment

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
Create a `.env` file with:
```
DISCORD_BOT_TOKEN=your_discord_bot_token
TWITCH_CLIENT_ID=your_twitch_client_id
TWITCH_SECRET=your_twitch_secret
PORT=3000
```

3. Start with PM2:
```bash
pm2 start index.js --name twitch-bot
```

## Commands

The bot supports both text commands (prefix `!t`) and Discord slash commands (`/twitch`)

### Text Commands

- `!t channel` - Sets up the current channel for stream notifications
- `!t add <streamer>` - Adds a Twitch streamer (e.g., `!t add inlayo0`)
- `!t delete <streamer>` - Removes a Twitch streamer (e.g., `!t delete inlayo0`)
- `!t list` - Shows all monitored streamers in this channel

### Slash Commands

- `/twitch channel` - Setup this channel for stream notifications
- `/twitch add streamer:<name>` - Add a Twitch streamer
- `/twitch delete streamer:<name>` - Remove a Twitch streamer
- `/twitch list` - List all streamers in this channel

Both command types work identically and provide the same functionality.

## File Structure

```
twitch-bot/
├── index.js              # Main bot file
├── settings/             # Channel-specific settings
│   └── {channelId}.json  # Per-channel streamer configuration
├── thumbnails/           # Cached stream thumbnails
├── .env                  # Environment variables (not tracked)
└── package.json          # Dependencies
```

## API Endpoints

- `GET /status` - Returns live status of all monitored streamers by channel
- `GET /discord` - Returns Discord bot connection status
- `GET /twitch` - Returns Twitch API token status

## How It Works

1. The bot checks all monitored streamers every 60 seconds
2. When a streamer goes live, it sends an embed notification with:
   - Stream title and game
   - Stream thumbnail
   - Direct link to the stream
3. Settings are stored per Discord channel in JSON files
4. Each channel can have its own list of streamers to monitor
