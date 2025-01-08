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
let _cacheImdbData = {}

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
                notif.setTitle( "Nouvel épisode")
            }

            let imdbData = await this.getImdbData(subdir.split('/')[0])
            Logger.debug("IMDB Data", imdbData)
            if (imdbData && imdbData.imdb_reviews) {
                notif.addFields({
                    name: "Note IMDb",
                    value: imdbData.imdb_reviews
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
                
                let thumbsUrl = ''
                if (imdbData && imdbData.image) {
                    thumbsUrl = imdbData.image
                } else if (config.has("thumbsUrl")) {
                    thumbsUrl = `${config.get("thumbsUrl")}/${encodeURIComponent(subdir.split('/')[0])}.png`
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

                if (imdbData && imdbData.url) {
                    let buttonImdb = new Discord.ButtonBuilder();
                    buttonImdb.setLabel('IMDb')
                    buttonImdb.setStyle(Discord.ButtonStyle.Link)
                    buttonImdb.setEmoji('🌟')
                    buttonImdb.setURL(imdbData.url)
                    actionRow.addComponents(buttonImdb)
                }
            }
            notif.setFooter({ text: _episodeHashText+hash })

            let messageContent = { embeds: [notif], components: [actionRow] }
            console.log(JSON.stringify(messageContent, null, 4));
            return messageContent
        }

        // Copy paste from clean bot discord (to refactor one day)
        public async getImdbData(search: string) {
            try {
                if (_cacheImdbData[search]) {
                    return _cacheImdbData[search]
                }
                let imdbData :any = {}
                let reply = await this.callApi(`https://www.imdb.com/find/?q=${encodeURIComponent(search)}`, null, "GET", "");
                if (reply.status != 200)
                {
                    Logger.error("Imdb get", "retrieveImdbInfos", "Cannot find imdb id for "+search, reply)
                    return null
                }
                let links = reply.data.split('href="/title/')
                if (links.length == 0)
                {
                    Logger.error("Imdb get", "retrieveImdbInfos", "Cannot find imdb id for "+search)
                    return null
                }

                let bestImdbId = links[1].split('/')[0]
                Logger.info("Imdb get", "retrieveImdbInfos", "Found imdbId for "+search, bestImdbId)

                let replyImdbPage = await this.callApi(`https://www.imdb.com/title/${bestImdbId}/`, null, "GET", "");
                if (replyImdbPage.status != 200)
                {
                    Logger.error("Imdb get", "retrieveImdbInfos", "Cannot find imdb page for id "+search, reply)
                    return null
                }
                imdbData.url = `https://www.imdb.com/title/${bestImdbId}`

                let pageHtml = replyImdbPage.data
                try {
                    // Image
                    let posterImgUrl = pageHtml.split('hero-media__poster')[1].split('sizes="')[0].split('https://').pop().split(' ')[0]
                    imdbData.image = 'https://' + posterImgUrl
                    Logger.info("Imdb get", "retrieveImdbInfos", "Found imdb poster")

                    // Title
                    let title = pageHtml.split('<title>')[1].split('</title>')[0].split('(')[0].trim()
                    imdbData.title = title
                    Logger.info("Imdb get", "retrieveImdbInfos", "Found imdb title", title)

                    // Ratings
                    let ratingStart = pageHtml.split('hero-rating-bar__aggregate-rating__score')
                    if (ratingStart.length == 1)
                    {
                        Logger.error("Imdb get", "retrieveImdbInfos", "Cannot find imdb rating for id "+search)
                        return null
                    }
                    let ratingHtml = ratingStart[1].split('</span>')
                    let average = ratingHtml[0].split('>')[2]
                    let votes = ratingHtml[2].split('>')[4].split('<')[0]
                    imdbData.review = average
                    imdbData.imdb_reviews = `**${average}/10** (${votes} votes)`
                    Logger.info("Imdb get", "retrieveImdbInfos", "Found imdb ratings ")                
                }
                catch (e) {
                    Logger.error("Imdb get", "retrieveImdbInfos", "Error while parsing imdb page for "+search)
                }
                _cacheImdbData[search] = imdbData
                return imdbData
            }
            catch (e) {
                Logger.error("Imdb get", "retrieveImdbInfos", "Error while getting imdb data for "+search, e)
                return null
            }
        }

        protected async sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        private async callApi(url = '', body = {}, method = 'POST', auth_header = "") 
        {
            await this.sleep(277);
            let response = null;
            try {
                response = await fetch(url, {
                    "headers": {
                        "accept": "*/*",
                        "accept-language": "en-US,en;q=0.9",
                        "content-type": "application/json; charset=UTF-8",
                        "sec-ch-ua": "\"Not_A Brand\";v=\"8\", \"Chromium\";v=\"120\"",
                        "sec-ch-ua-mobile": "?0",
                        "sec-ch-ua-platform": "\"macOS\"",
                        "sec-fetch-dest": "empty",
                        "sec-fetch-mode": "cors",
                        "sec-fetch-site": "same-origin",
                        "x-requested-with": "XMLHttpRequest",
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                        "Authorization": auth_header == "" ? null : auth_header
                    },
                    "body": body == null ? null : JSON.stringify(body),
                    "method": method
                });
            }
            catch (e)
            {
                Logger.error("Error while calling API "+url, e);
                return {
                    status: 500,
                    error: e,
                    isJson: false
                }
            }
            

            let rawData:any = await response.text();
            if (response.status != 200 && response.status != 201)
            {
                return {
                    status: response.status,
                    error: response.statusText + " - " + rawData,
                    isJson: false
                }
            }
            let isJson = false
            try {
                rawData = JSON.parse(rawData);
                isJson = true;
            }
            catch (e) {
                // Not json
            }
			if (isJson && rawData.status == 400)
			{
				rawData.error = rawData.message
			}

			if (isJson && rawData.error)
			{
				return {
					status: 500,
					error: rawData.error,
					isJson: false
				}
			}
            return {
                status: response.status,
                isJson: isJson,
                data: rawData
            }
        }
    }
}

export default DiscordBot
