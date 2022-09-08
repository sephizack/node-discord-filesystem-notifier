import Discord, { Base } from 'discord.js'
import Logger from './logger.js'
import config from 'config';
import https from 'https'
import dns from 'dns'
import axios from 'axios'

let myHttpsAgent = new https.Agent({
    rejectUnauthorized: false
})

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
            this.client = new Discord.Client();
            this.differentIPTimeout = null
            this.currentIP = undefined
            this.domainName = config.has("publicFilesHostname") ? config.get("publicFilesHostname") : ""
            this.domainIP = undefined
            this.botUsername = "(not logged)"
            this.channelIDsToNotify = []
            for (let aNotifyAction of notifyConfig) {
                if (aNotifyAction['channel']) {
                    this.channelIDsToNotify.push(aNotifyAction['channel'])
                }
            }
            this.checkIPAdresses()
            this.setupClient()
            this.client.login(token).catch((error) => {
                Logger.error(this.prefix(), "Unable to conect to Discord", error)
                this.isConnected = false
            });
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
                Logger.ok(this.prefix(), `Sucessfully logged in as ${this.client.user.tag} !`);
                //Logger.debug(this.prefix(), this.client);
                this.getChannels()
            });
            this.client.on('message', message => {
                this.handleSpecialMessage(message)
            });
        }

        public dnsResolvePromise(domain) {
            return new Promise((resolve, reject) => {
                dns.resolve4(domain, (err, addresses) => {
                    if(err || !addresses) reject(err);
                    resolve(""+addresses[0]);
                });
           });
        }

        public async checkIPAdresses() {
            try {
                // Logger.debug('Checking IP adresses...')
                let aAtLeastOneUpdated = false;
                let ipResult = await axios.get('https://api.ipify.org', { httpsAgent:myHttpsAgent, timeout:0 })
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
                                let message = new Discord.MessageEmbed().setTitle('Difference d\'IP detectée !').setDescription(
                                    '**L\'adresse IP du NAS est differente de celle du domaine depuis plus de 20 minutes !**\n' + this.buildIpMessage());
                                for (let aChannel of this.channelsToNotify) {
                                    aChannel.send(message)
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

        public buildNotifContent(basedir, subdir, filename):any {
            return `File '${filename}' added to folder '${subdir}' in '${basedir}'`
        }
        
        public sendNotif(basedir, subdir, filename) {
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
            else {
                let aNotification = this.buildNotifContent(basedir, subdir, filename)
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

        private handleSpecialMessage(message)
        {
            if (message.content === "!ip") {
                message.reply(new Discord.MessageEmbed().setTitle('IP Actuelle').setDescription(this.buildIpMessage()))
            }
        }

        private async getChannels() {
            this.channelsToNotify = []
            for (let aChannelId of this.channelIDsToNotify) {
                try {
                    let channel = await this.client.channels.fetch(aChannelId);
                    this.channelsToNotify.push(channel)
                    channel.on('message', message => {
                        this.handleSpecialMessage(message)
                    });
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
    }

    export class AnimeDiscordBot extends BaseDiscordBot {
        public constructor(token: string, notifyConfig:any, customData:any) {
            super(token, notifyConfig, customData)
        }

        public buildNotifContent(basedir, subdir, filename):any {
            let notif = new Discord.MessageEmbed();
            notif.setColor('#0099ff')

            if (basedir !== '/') {
                if (subdir.indexOf("Films") == 0 || subdir.indexOf("OAVs") == 0) {
                    notif.setDescription(`Un **nouvel OAV** est dispo sur le NAS !`)
                    notif.setTitle("Nouvel OVA")
                } else {
                    notif.setDescription(`Un nouvel épisode de **${subdir.replace(/\//g, ' ')}** est dispo sur le NAS !`)
                    notif.setTitle(`${subdir.replace(/\//g, ' ')}`)
                }
            } else {
                notif.setDescription(`Un nouvel épisode est dispo sur le NAS !`)
                notif.setTitle( "Nouvel épisode")
            }
            if (config.has("publicFilesUrl") && config.get("publicFilesUrl") !== "") {
                let baseUrl = config.get("publicFilesUrl");
                notif.setURL(`${baseUrl}/${encodeURIComponent(subdir)}/${encodeURIComponent(filename)}`)
                if (config.has("thumbsUrl")) {
                    notif.setThumbnail(`${config.get("thumbsUrl")}/${encodeURIComponent(subdir)}.png`)
                }
                notif.addField("Episode", `${baseUrl}/${encodeURIComponent(subdir)}/${encodeURIComponent(filename)}`)
                notif.addField("Dossier", `${baseUrl}/${encodeURIComponent(subdir)}`)
                notif.setFooter('Retrouvez le mot de passe en message epinglé sur le discord')
            }
            else
            {
                notif.addField("Nom du fichier", filename)
            }
            return notif;
        }
    }
}

export default DiscordBot