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

All commands use the prefix `!t`

### `!t channel`
Sets up the current channel for stream notifications.
- **Usage:** `!t channel`
- **Description:** Initializes the channel for receiving stream notifications

### `!t add <streamer>`
Adds a Twitch streamer to the monitoring list.
- **Usage:** `!t add <streamer_name>`
- **Example:** `!t add inlayo0`
- **Description:** Adds the specified Twitch streamer to this channel's notification list

### `!t delete <streamer>`
Removes a Twitch streamer from the monitoring list.
- **Usage:** `!t delete <streamer_name>`
- **Example:** `!t delete inlayo0`
- **Description:** Removes the specified Twitch streamer from this channel's notification list

### `!t list`
Shows all streamers being monitored in this channel.
- **Usage:** `!t list`
- **Description:** Displays a list of all streamers currently being monitored with their Twitch IDs

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
