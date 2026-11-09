import Discord from 'discord.js'
import Logger from './logger.js'
import config from 'config';
import https from 'https'
import dns from 'dns'
import axios from 'axios'

let myHttpsAgent = new https.Agent({
    rejectUnauthorized: false
})

const _episodeHashText = 'Hash: ';
interface TmdbTitle {
    id: number;
    media_type: 'movie' | 'tv';
    title?: string;
    name?: string;
    original_title?: string;
    original_name?: string;
    vote_average: number;
    vote_count: number;
    poster_path: string | null;
}
let _cacheTmdbData = new Map<string, TmdbTitle>()

module DiscordBot {

    export function createFromType(type:string, token: string, notifyConfig:any, customData:any) {
        let availableTypes = {
            "Anime" : (token: string, notifyConfig:any, customData:any) => {
                return new AnimeDiscordBot(token, notifyConfig, customData)
            }
        }
        if (availableTypes[type]) {
            return availableTypes[type](token, notifyConfig, customData);
        } else {
            throw `Discord Bot Error: Unknown type '${type}'. Available: ${Object.keys(availableTypes).join(', ')}`
        }
    }

    export class BaseDiscordBot {
        public constructor(token: string, notifyConfig:any, customData:any) {
            this.client = new Discord.Client({
                intents: [Discord.GatewayIntentBits.MessageContent
                        ,Discord.GatewayIntentBits.GuildMessages
                        ,Discord.GatewayIntentBits.DirectMessages
                        ,Discord.GatewayIntentBits.GuildIntegrations
                        ,Discord.GatewayIntentBits.Guilds]
                
            });
            this.differentIPTimeout = null
            this.currentIP = undefined
            this.domainName = config.has("publicFilesHostname") ? config.get("publicFilesHostname") : ""
            this.domainIP = undefined
            this.botUsername = "(not logged)"
            this.channelIDsToNotify = []
            this.hashesToSkip = new Set()
            for (let aNotifyAction of notifyConfig) {
                if (aNotifyAction['channel']) {
                    this.channelIDsToNotify.push(aNotifyAction['channel'])
                }
            }
            this.checkIPAdresses()
            this.setupClient()

            let thisBot = this;
            let discordLogin = () => {
                if (!thisBot.isConnected) {
                    Logger.info(thisBot.prefix(), "Appempting connection to discord")
                    thisBot.client.login(token).catch((error) => {
                        Logger.error(thisBot.prefix(), "Unable to conect to Discord", error)
                        thisBot.isConnected = false
                    });
                }
            }
            discordLogin();
            setInterval(discordLogin, 2*60*1000);
        }

        private buildIpMessage() {
            let message = "IP actuelle non détectée"
            if (this.currentIP) {
                let url = config.get("publicFilesUrl");
                url = url.replace(this.domainName, this.currentIP)
                message = `IP du NAS: **${this.currentIP}**\n`
                        + `IP du domaine *${this.domainName}*: ${this.domainIP}\n`
                        + `Addresse du serveur avec IP actuelle: ${url}`
            }
            return message
        }

        private setupClient() {
            this.client.on('ready', () => {
                this.isConnected = true
                this.botUsername = this.client.user.username
                Logger.ok(this.prefix(), `Sucessfully logged in as ${this.client.user.tag} ! (Discriminator: ${this.client.user.discriminator})`);
                //Logger.debug(this.prefix(), this.client);
                this.getChannels()
            });
            this.client.on('disconnect', () => {
                this.isConnected = false
            });
            this.client.on(Discord.Events.MessageCreate, message => {
                this.handleSpecialMessage(message)
            });
        }

        public dnsResolvePromise(domain) {
            return new Promise((resolve, reject) => {
                dns.resolve6(domain, (err, addresses) => {
                    if(err || !addresses) {
                        reject(err);
                    } else {
                        resolve(""+addresses[0]);
                    }
                });
           });
        }

        public async checkIPAdresses() {
            try {
                // Logger.debug('Checking IP adresses...')
                let aAtLeastOneUpdated = false;
                let ipResult = await axios.get('https://api6.ipify.org', { httpsAgent:myHttpsAgent, timeout:0 })
                // Logger.debug("IP reply", ipResult.data)
                if (ipResult.status == 200)
                {
                    if (ipResult.data != this.currentIP) {
                        this.currentIP = ipResult.data;
                        Logger.ok('Current IP updated:', this.currentIP)
                        aAtLeastOneUpdated = true
                    }
                }
                else
                {
                    Logger.warning('Unable to get current public IP. Got HTTP code:', ipResult.status)
                }
                if (this.domainName) {
                    let address:any = null;
                    let updateDomainIp = (ip) => {
                        this.domainIP = address
                        aAtLeastOneUpdated = true
                        Logger.ok('Current domain IP updated:', this.domainIP)
                    }
                    try {
                        address = await this.dnsResolvePromise(this.domainName)
                        if (this.domainIP != address) {
                            updateDomainIp(address)
                        }
                    }
                    catch (e) {
                        Logger.warning('Unable to find ip for domain', this.domainName, e);
                        if (this.domainIP) {
                            updateDomainIp(null)
                        }
                    }

                    // Notify in case of different IP
                    if (aAtLeastOneUpdated) {
                        if (this.domainIP != this.currentIP) {
                            this.differentIPTimeout = setTimeout(() => {
                                let message = new Discord.EmbedBuilder()
                                        .setTitle('Difference d\'IP detectée !')
                                        .addFields({
                                            name: 'L\'adresse IP du NAS est differente de celle du domaine depuis plus de 20 minutes !',
                                            value: this.buildIpMessage()
                                        });
                                for (let aChannel of this.channelsToNotify) {
                                    aChannel.send({ embeds: [message]})
                                }
                                Logger.ok("Notify for different IP sent!")
                            }, 1000*60*2);
                            Logger.info("Timer started to notify different IP...")
                        } else {
                            if (this.differentIPTimeout) {
                                clearTimeout(this.differentIPTimeout)
                                this.differentIPTimeout = null
                            }
                        }
                    }
                }
            } catch(e) {
                Logger.warning('Unable to find current IP', e)
            }
            setTimeout(() => {
                this.checkIPAdresses()
            }, 20000)
        }

        public async buildNotifContent(basedir, subdir, filename, hash) : Promise<any> {
            return `File '${filename}' added to folder '${subdir}' in '${basedir}'`
        }
        
        public async sendNotif(basedir, subdir, filename, hash) {
            let fileExtension = filename.split('.').pop().toLowerCase()
            if (['mp4', 'mkv', 'avi'].indexOf(fileExtension) == -1) {
                Logger.debug(`Notification skipped as file extension '${fileExtension}' is not elligible`)
            }
            else if (basedir.indexOf('/_') !== -1 || subdir.indexOf('/_') !== -1 || subdir.indexOf('_') == 0) {
                Logger.ok("Notification skipped as path contains a folder starting by _")
            }
            else if (!this.isConnected) {
                Logger.warning(this.prefix(), "Notification skipped as Bot is not connected")
            }
            else if (this.hashesToSkip.has(hash)) {
                Logger.ok(this.prefix(), "Notification skipped as Hash is known")
            }
            else {
                let aNotification = await this.buildNotifContent(basedir, subdir, filename, hash)
                Logger.debug(this.prefix(), "Notification content:", aNotification);
                Logger.info(this.prefix(), "Sending notif message to discord...");
                if (config.has("skipAcutalNotif") && config.get("skipAcutalNotif")) {
                    Logger.debug(this.prefix(), "Notification skipped as per config");
                    return
                }
                for (let aChannel of this.channelsToNotify) {
                    aChannel.send(aNotification)
                }
            }
        }

        private async handleSpecialMessage(message)
        {
            if (message.author && message.author.discriminator == this.client.user.discriminator)
            {
                return
            }
            if (message.content === "!ip") {
                message.reply({ embeds: [new Discord.EmbedBuilder().setTitle('IP Actuelle').setDescription(this.buildIpMessage())]})
            }
            if (message.embeds && message.embeds.length > 0) {
                try
                {
                    let aFirstEmbed = message.embeds[0]
                    if (aFirstEmbed && aFirstEmbed.footer)
                    {
                        let aFooterText = aFirstEmbed.footer.text
                        if (aFooterText.indexOf(_episodeHashText) !== -1) {
                            let aHashToSkip = aFooterText.replace(_episodeHashText, '');
                            this.hashesToSkip.add(aHashToSkip);
                            Logger.debug('Will ignore hash:', aHashToSkip)
                            // Now react of this message to flex
                            message.react('👌');
                        }
                    }
                } catch(e) {
                    Logger.error('Exception while reading embeds', e)
                }
            }
            if (message.content === "!test") {
                message.reply(
                    await this.buildNotifContent(
                        'Mangas',
                        'Kimetsu no Yaiba',
                        'Demon Slayer S04E02 VOSTFR 1080p WEB [x264 AAC] -Tsundere-Raws (CR).mkv',
                        '3033152882e129f27c5103bc5cc44bcdf0a15e160d445066ff'
                    )
                )
            }
        }

        private async getChannels() {
            this.channelsToNotify = []
            for (let aChannelId of this.channelIDsToNotify) {
                try {
                    let channel = await this.client.channels.fetch(aChannelId);
                    this.channelsToNotify.push(channel)
                    Logger.ok(this.prefix(), `Channel with ID '${aChannelId}' ready to be notified`)
                } catch (error) {
                    Logger.warning(this.prefix(), `Channel with ID '${aChannelId}' not found:`, error)
                }
            }
        }

        private getUsers() {
            //this.channelsToNotify = this.client.users.find(c => this.channelIDsToNotify.indexOf(c.name) !== -1);
            //Logger.info(this.prefix(), `Found ${Object.keys(this.channelsToNotify).length} channels to notify`)
        }

        private prefix() {
            return `[Discord ${this.botUsername}]`
        }

        isConnected: boolean;
        botUsername:string
        currentIP:string
        domainName:string
        domainIP:string
        client:any;
        channelsToNotify:any;
        differentIPTimeout:any;
        channelIDsToNotify:string[];
        hashesToSkip:Set<string>;
    }

    export class AnimeDiscordBot extends BaseDiscordBot {
        public constructor(token: string, notifyConfig:any, customData:any) {
            super(token, notifyConfig, customData)
        }

        public clarifyFileName(filename):any {
            filename = filename.replace('VOSTFR', '')
            filename = filename.replace('1080p', '')
            filename = filename.replace('WEB', '')
            filename = filename.replace(/_/g, ' ')
            filename = filename.replace(/ *\[.*?\] */g, "")
            filename = filename.replace(/ *\([^)]*\) */g, "")
            filename = filename.replace(/\.[^/.]+$/, "")
            return filename.trim()
        }

        public filterSearchInput(str) {
            let directories = str.split('/')
            // Remove season patterns from each directory part and filter out complex directories
            let cleanedDirs = directories
                .map(dir => {
                    // Remove patterns like "Season X", "Saison X", "S01", etc.
                    return dir
                        .replace(/\b(Season|Saison)\s+\d+/gi, '')
                        .replace(/\bS\d{1,2}\b/gi, '')
                        .trim()
                })
                .filter(dir => {
                    // Filter out empty strings
                    if (dir.length === 0) return false;
                    
                    // Ignore directories containing file/codec/quality related patterns
                    const filePatternsRegex = /\b(x264|x265|h\.?264|h\.?265|hevc|avc|1080p|720p|480p|360p|bluray|web-?dl|webrip|hdtv|dvdrip|dts|aac|mp3|flac|opus|10bit|8bit)\b/gi;
                    if (filePatternsRegex.test(dir)) return false;
                    
                    return true;
                })
            if (cleanedDirs.length === 0) {
                return directories.join(' ').trim();
            }
            return cleanedDirs.join(' ').trim()
        }

        public async buildNotifContent(basedir, subdir, filename, hash) : Promise<any> {
            let notif = new Discord.EmbedBuilder();
            notif.setColor('#0099ff')

            if (basedir !== '/') {
                if (subdir.indexOf("Films") == 0 || subdir.indexOf("OAVs") == 0) {
                    notif.setDescription(`Un **nouvel OAV** est dispo sur le NAS !`)
                    notif.setTitle("Nouvel OAV")
                } else {
                    notif.setDescription(`Un nouvel épisode de **${subdir.replace(/\//g, ' ')}** est dispo sur le NAS !`)
                    notif.setTitle(`${subdir.replace(/\//g, ' ')}`)
                }
            } else {
                notif.setDescription(`Un nouvel épisode est dispo sur le NAS !`)
                notif.setTitle("Nouvel épisode")
            }


            let tmdbData = await this.getTmdbData(this.filterSearchInput(subdir))
            Logger.debug("TMDb Data", tmdbData)
            if (tmdbData && tmdbData.vote_count > 0) {
                let tmdbRatingString = `**${tmdbData.vote_average}/10**`
                if(tmdbData.vote_count)
                {
                    tmdbRatingString += ` (${tmdbData.vote_count} votes)`
                }
                notif.addFields({
                    name: "Note TMDb",
                    value: tmdbRatingString
                })
            }

            notif.addFields({
                name: "Episode",
                value: this.clarifyFileName(filename)
            })


            let actionRow = new Discord.ActionRowBuilder();
            if (config.has("publicFilesUrl") && config.get("publicFilesUrl") !== "") {
                let baseUrl = config.get("publicFilesUrl");
                let episodeURL = `${baseUrl}/${encodeURIComponent(subdir)}/${encodeURIComponent(filename)}`
                notif.setURL(episodeURL)
                
                let sephiImageUrl = ''
                let isSephiImageUrlValid = false;
                if (config.get("thumbsUrl")) {
                    sephiImageUrl = `${config.get("thumbsUrl")}/${encodeURIComponent(subdir.split('/')[0])}.png`
                    try {

                        let headResponse = await axios.head(sephiImageUrl, { httpsAgent:myHttpsAgent, timeout:5000 })
                        if (headResponse.status == 200) {
                            isSephiImageUrlValid = true;
                        }
                    } catch(e) {
                        Logger.warning("Sephi image not found at url", sephiImageUrl)
                    }
                }
                let thumbsUrl = ''
                if (isSephiImageUrlValid) {
                    thumbsUrl = sephiImageUrl
                } else if (tmdbData && tmdbData.poster_path) {
                    thumbsUrl = `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}`
                }
                if (thumbsUrl) {
                    notif.setImage(thumbsUrl)
                }
                let buttonEpisode = new Discord.ButtonBuilder();
                buttonEpisode.setLabel('Télécharger')
                buttonEpisode.setStyle(Discord.ButtonStyle.Link)
                buttonEpisode.setEmoji('📺')
                buttonEpisode.setURL(episodeURL)
                
                let buttonFolder = new Discord.ButtonBuilder();
                buttonFolder.setLabel(subdir.length > 80 ? subdir.substring(0, 77) + '...' : subdir)
                buttonFolder.setStyle(Discord.ButtonStyle.Link)
                buttonFolder.setEmoji('📂')
                buttonFolder.setURL(`${baseUrl}/${encodeURIComponent(subdir)}`)
                
                actionRow.addComponents(buttonEpisode)
                actionRow.addComponents(buttonFolder)

                if (tmdbData && tmdbData.id) {
                    let buttonTmdb = new Discord.ButtonBuilder();
                    buttonTmdb.setLabel('TMDb')
                    buttonTmdb.setStyle(Discord.ButtonStyle.Link)
                    buttonTmdb.setEmoji('🌟')
                    buttonTmdb.setURL(`https://www.themoviedb.org/${tmdbData.media_type}/${tmdbData.id}`)
                    actionRow.addComponents(buttonTmdb)
                }
            }
            notif.setFooter({ text: _episodeHashText+hash })

            let messageContent = { embeds: [notif], components: [actionRow] }
            console.log(JSON.stringify(messageContent, null, 4));
            return messageContent
        }

        public normalizeStr(str)
        {
            str = str.replaceAll(":", "")
            str = str.replaceAll("!", "")
            str = str.replaceAll("?", "")
            str = str.replaceAll(".", "")
            str = str.toLowerCase()
            str = str.trim()
            return str;
        }

        public getBestMatchingShow(titles: TmdbTitle[], originalSearch: string): TmdbTitle
        {
            let bestNbMatchingWords = 0;
            let originalSearchWords = originalSearch.split(" ");
            originalSearchWords = originalSearchWords.map((e) => {
                e = this.normalizeStr(e)
                return e;
            });
            console.log("original search words:", originalSearchWords)
            let bestTitles: TmdbTitle[] = []
            for(let i=0; i<titles.length; ++i)
            {
                let currentTitle = titles[i];
                let titleName = currentTitle.title || currentTitle.name || currentTitle.original_title || currentTitle.original_name || '';
                console.log("Title:", titleName);
                let currentTitleWords = titleName.split(" ");
                let nbMatchingWords = 0;
                for(let word of currentTitleWords)
                {
                    if(originalSearchWords.indexOf(this.normalizeStr(word)) != -1)
                    {
                        nbMatchingWords++;
                    }
                }
                console.log("Matching words:", nbMatchingWords);
                if(nbMatchingWords > bestNbMatchingWords)
                {
                    bestTitles = [currentTitle];
                    bestNbMatchingWords = nbMatchingWords;
                }
                else if(nbMatchingWords == bestNbMatchingWords)
                {
                    bestTitles.push(currentTitle);
                }
            }
            console.log("Best matching titles:", bestTitles);
            // Remove titles with very low rating (less than 3/10), or low vote count (less than 500 votes)
            bestTitles = bestTitles.filter((title) => {
                if (title.vote_average && title.vote_average < 3) {
                    return false;
                }
                if (title.vote_count && title.vote_count < 500) {
                    return false;
                }
                return true;
            })
            console.log("Best matching titles after filtering low ratings/votes:", bestTitles);
            // No best title found, just return the first result from the unfiltered list
            if (bestTitles.length == 0) {
                return titles[0];
            }
            return bestTitles[0];
        }

        public async getTmdbData(search:string): Promise<TmdbTitle | null>
        {
            console.log("Getting TMDb data for search:", search)
            try {
                let cachedTitle = _cacheTmdbData.get(search);
                if (cachedTitle) {
                    console.log("Returning cached TMDb data for search:", search)
                    return cachedTitle
                }
                if (!config.has("ztBot.tmdbAccessToken") || !config.get("ztBot.tmdbAccessToken")) {
                    Logger.warning("TMDb access token missing: configure ztBot.tmdbAccessToken")
                    return null
                }
                let token = config.get("ztBot.tmdbAccessToken");
                let reply = await this.callApi(`https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(search)}&language=fr-FR&include_adult=false`, {}, "GET", `Bearer ${token}`);
                if (reply.status != 200)
                {
                    Logger.error("TMDb get", "getTmdbData", "Cannot find TMDb title for "+search, reply)
                    return null
                }
                let titles: TmdbTitle[] = (reply.data.results || []).filter((title: {media_type: string}) => title.media_type === 'movie' || title.media_type === 'tv');
                if(titles.length > 0)
                {
                    let bestMatch = this.getBestMatchingShow(titles, search);
                    // Cache the result to avoid future API calls for the same search
                    _cacheTmdbData.set(search, bestMatch);
                    Logger.debug("Cached TMDb data for search:", search)
                    return bestMatch;
                }
                else
                {
                    Logger.error("TMDb get", "getTmdbData", "Nothing found for TMDb search: "+search)
                    return null
                }
            }
            catch (e) {
                Logger.error("TMDb get", "getTmdbData", "Error while getting TMDb data for "+search, e)
                return null
            }
        }

        protected async sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        private async callApi(url = '', body = {}, method = 'POST', auth_header = "") : Promise<any>
        {
            await this.sleep(277);
            let response = null;
            try {
                let headers: any = {
                    "headers": {
                        "accept": "application/json",
                        "content-type": "application/json; charset=UTF-8",
                        "Authorization": auth_header == "" ? null : auth_header
                    },
                    "method": method
                };
                if(method != "GET")
                {
                    headers.body = body == null ? null : JSON.stringify(body)
                }
                response = await fetch(url, headers);
            }
            catch (e)
            {
                Logger.error("Error while calling API "+url, e);
                return {
                    status: 500,
                    error: e
                }
            }
            
            let jsonData:any = await response.json();
            if (response.status != 200 && response.status != 201)
            {
                return {
                    status: response.status,
                    error: response.statusText + " - " + jsonData
                }
            }
            
            return {
                status: response.status,
                data: jsonData
            }
        }

    }
}

export default DiscordBot
