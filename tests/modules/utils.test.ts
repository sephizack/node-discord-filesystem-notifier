jest.mock('config', () => ({has: jest.fn(), get: jest.fn()}));

import config from 'config';
import axios from 'axios';
import DiscordBot from '../../src/modules/discord_bot';

let bot: DiscordBot.AnimeDiscordBot;
let fetchMock: jest.Mock;
let settings: {[key: string]: any};
const originalFetch = global.fetch;

const tvTitle = {
    id: 85937,
    media_type: 'tv',
    name: 'Demon Slayer',
    vote_average: 8.7,
    vote_count: 6000,
    poster_path: '/demon-slayer.jpg'
};

beforeEach(() => {
    jest.restoreAllMocks()
    jest.spyOn(console, 'log').mockImplementation(() => {});
    bot = Object.create(DiscordBot.AnimeDiscordBot.prototype);
    jest.spyOn(bot as any, 'sleep').mockResolvedValue(undefined);
    settings = {
        'ztBot.tmdbAccessToken': 'test-token',
        publicFilesUrl: 'https://files.example.com',
        thumbsUrl: ''
    };
    jest.spyOn(config, 'has').mockImplementation((key) => Object.prototype.hasOwnProperty.call(settings, key));
    jest.spyOn(config, 'get').mockImplementation((key: string) => settings[key]);
    fetchMock = jest.fn().mockResolvedValue({
        status: 200,
        json: async () => ({results: [tvTitle]})
    });
    global.fetch = fetchMock;
});

afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
});

test('TMDb search authenticates, filters people and caches the selected TV show', async () => {
    fetchMock.mockResolvedValueOnce({
        status: 200,
        json: async () => ({results: [
            {id: 1, media_type: 'person', name: 'Actor'},
            {...tvTitle, name: 'Demon Slayer search & cache'},
            {id: 2, media_type: 'movie', title: 'Unrelated', vote_average: 9, vote_count: 9000}
        ]})
    } as any);

    const result = await bot.getTmdbData('Demon Slayer search & cache');
    expect(result.id).toBe(tvTitle.id);
    expect(fetchMock).toHaveBeenCalledWith(
        'https://api.themoviedb.org/3/search/multi?query=Demon%20Slayer%20search%20%26%20cache&language=fr-FR&include_adult=false',
        expect.objectContaining({method: 'GET', headers: expect.objectContaining({
            accept: 'application/json', Authorization: 'Bearer test-token'
        })})
    );
    expect(await bot.getTmdbData('Demon Slayer search & cache')).toBe(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
});

test.each(['movie', 'tv'])('notification uses the TMDb rating, poster and %s link', async (mediaType) => {
    const search = `TMDb notification ${mediaType}`;
    fetchMock.mockResolvedValueOnce({
        status: 200,
        json: async () => ({results: [{...tvTitle, media_type: mediaType, title: search, name: search}]})
    } as any);
    const message = await bot.buildNotifContent('Mangas', search, 'Episode S01E01.mkv', 'test-hash');
    const embed = message.embeds[0].toJSON();
    const buttons = message.components[0].toJSON().components;

    expect(embed.fields).toContainEqual({name: 'Note TMDb', value: '**8.7/10** (6000 votes)'});
    expect(embed.image.url).toBe('https://image.tmdb.org/t/p/w500/demon-slayer.jpg');
    expect(embed.footer.text).toBe('Hash: test-hash');
    expect(buttons).toHaveLength(3);
    expect(buttons[2]).toMatchObject({label: 'TMDb', url: `https://www.themoviedb.org/${mediaType}/${tvTitle.id}`});
});

test('local artwork remains preferred over the TMDb poster', async () => {
    settings.thumbsUrl = 'https://images.example.com';
    jest.spyOn(axios, 'head').mockResolvedValue({status: 200});
    const message = await bot.buildNotifContent('Mangas', 'TMDb local artwork', 'Episode.mkv', 'hash');
    expect(message.embeds[0].toJSON().image.url).toBe('https://images.example.com/TMDb%20local%20artwork.png');
});

test.each(['missing', 'empty'])('notification still works with a %s TMDb token', async (tokenState) => {
    if (tokenState === 'missing') {
        delete settings['ztBot.tmdbAccessToken'];
    } else {
        settings['ztBot.tmdbAccessToken'] = '';
    }
    const message = await bot.buildNotifContent('Mangas', `TMDb ${tokenState} token`, 'Episode.mkv', 'hash');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(message.embeds[0].toJSON().fields).toEqual([{name: 'Episode', value: 'Episode'}]);
    expect(message.components[0].toJSON().components).toHaveLength(2);
});

test.each([{results: []}, {results: [{id: 1, media_type: 'person', name: 'Actor'}]}])('non-title results are ignored: %j', async ({results}) => {
    fetchMock.mockResolvedValueOnce({status: 200, json: async () => ({results})} as any);
    expect(await bot.getTmdbData(`TMDb no titles ${results.length}`)).toBeNull();
});

test.each([401, 429, 500])('notification survives a TMDb HTTP %s error', async (status) => {
    fetchMock.mockResolvedValueOnce({status, statusText: 'API error', json: async () => ({})} as any);
    const message = await bot.buildNotifContent('Mangas', `TMDb HTTP ${status}`, 'Episode.mkv', 'hash');
    expect(message.embeds[0].toJSON().fields).toEqual([{name: 'Episode', value: 'Episode'}]);
});

test('notification survives a TMDb network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network unavailable'));
    const message = await bot.buildNotifContent('Mangas', 'TMDb network error', 'Episode.mkv', 'hash');
    expect(message.embeds[0].toJSON().fields).toEqual([{name: 'Episode', value: 'Episode'}]);
});

test('unrated titles without posters do not add a rating or image', async () => {
    fetchMock.mockResolvedValueOnce({
        status: 200,
        json: async () => ({results: [{...tvTitle, vote_average: 0, vote_count: 0, poster_path: null}]})
    } as any);
    const message = await bot.buildNotifContent('Mangas', 'TMDb unrated', 'Episode.mkv', 'hash');
    const embed = message.embeds[0].toJSON();
    expect(embed.fields).toEqual([{name: 'Episode', value: 'Episode'}]);
    expect(embed.image).toBeUndefined();
});

