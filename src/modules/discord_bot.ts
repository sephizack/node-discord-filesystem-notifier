import Discord, { Base } from 'discord.js'
import Logger from './logger.js'

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
            this.botUsername = "(not logged)"
            this.channelIDsToNotify = []
            for (let aNotifyAction of notifyConfig) {
                if (aNotifyAction['channel']) {
                    this.channelIDsToNotify.push(aNotifyAction['channel'])
                }
            }
            this.setupClient()
            this.client.login(token).catch((error) => {
                Logger.error(this.prefix(), "Unable to conect to Discord", error)
                this.isConnected = false
            });
        }

        private setupClient() {
            this.client.on('ready', () => {
                this.isConnected = true
                this.botUsername = this.client.user.username
                Logger.ok(this.prefix(), `Sucessfully logged in as ${this.client.user.tag} !`);
                //Logger.debug(this.prefix(), this.client);
                this.getChannels()
            });
        }

        public buildNotifContent(basedir, subdir, filename) {
            return `File '${filename}' added to folder '${subdir}' in '${basedir}'`
        }
        
        public sendNotif(basedir, subdir, filename) {
            if (basedir.indexOf('/watched') !== -1 || subdir.indexOf('/watched') !== -1) {
                Logger.ok("Notification skipped as path contains /watched")
            }
            else if (!this.isConnected) {
                Logger.warning(this.prefix(), "Notification skipped as Bot is not connected")
            }
            else {
                let aNotification = this.buildNotifContent(basedir, subdir, filename)
                Logger.debug(this.prefix(), "Notification content:", aNotification);
                Logger.info(this.prefix(), "Sending notif message to discord...");
                for (let aChannel of this.channelsToNotify) {
                    aChannel.send(aNotification)
                }
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
        client:any;
        channelsToNotify:any;
        channelIDsToNotify:string[];
    }

    export class AnimeDiscordBot extends BaseDiscordBot {
        public constructor(token: string, notifyConfig:any, customData:any) {
            super(token, notifyConfig, customData)
        }

        public buildNotifContent(basedir, subdir, filename) {
            let notifData = ""
            if (basedir !== '/') {
                notifData = `Un nouvel épisode de **${subdir.replace(/\//g, ' ')}** est dispo sur le NAS !`
            } else {
                notifData = `Un nouvel épisode est dispo sur le NAS !\n${filename}`
            }
            notifData += `\n*${filename}*`
            return notifData
        }
    }
}

export default DiscordBot