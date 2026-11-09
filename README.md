# node-discord-filesystem-notifier
Node process scanning some folders of your file system and sending notifications to Discord

Notification content is built in BaseDiscordBot child classes.
Simply create your own to customize your notifs, see AnimeDiscordBot

## TMDb

AnimeDiscordBot uses TMDb to look up movies and TV shows and add ratings,
posters and a TMDb link to notifications. Local artwork remains preferred.

Set your TMDb **API Read Access Token** in `config/local.json`:

```json
{
	"ztBot": {
		"tmdbAccessToken": "YOUR_TMDB_API_READ_ACCESS_TOKEN"
	}
}
```

Use the read access token, not the API key. It is sent as a Bearer token.
Without a token, or if TMDb is unavailable, notifications still work without
TMDb metadata. Keep your token private.

This product uses the TMDB API but is not endorsed or certified by TMDB.