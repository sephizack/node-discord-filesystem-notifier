import Logger from './modules/logger.js'
import DiscordBot from './modules/discord_bot.js'
import chokidar from 'chokidar'
import config from 'config';
import sha1 from 'sha1';
import fs from 'fs/promises';
import { Buffer } from 'buffer';

//const client = new Discord.Client();
//client.login('token');

Logger.info("Discord Notifier starting...")

if (!config.has("DirectoriesToWatch")) {
    Logger.warning("You must provide the config 'DirectoriesToWatch'")
    process.exit(1);
}

if (!config.has("DiscordsBots")) {
    Logger.warning("You must provide the config 'DiscordsBots'")
    process.exit(1);
}

// Initialize Discord clients
let allDiscordsBots = []
for (let discordSetup of config.get("DiscordsBots")) {
    if (discordSetup.type == "YOUR_TYPE") {
        continue
    }
    let aDiscordBot = DiscordBot.createFromType(
        discordSetup.type,
        discordSetup.token,
        discordSetup.notify,
        discordSetup.customData
    )
    allDiscordsBots.push(aDiscordBot)
}

const kBufferSizeToHash = 1024*4
async function hashFile(path, stats){
    let beforeHash = new Date().getTime()
    let fileHandler = await fs.open(path, 'r')
    let fileSize:number = stats.size;
    const hashingBuffer = Buffer.allocUnsafe(kBufferSizeToHash);
    fileHandler.read(hashingBuffer, 0, Math.min(kBufferSizeToHash, fileSize/4), fileSize/2)
    fileHandler.close()
    let fileHash = ""+fileSize+sha1(hashingBuffer)
    Logger.debug(`File hashed in ${new Date().getTime() - beforeHash} ms`)
    return fileHash
}


let startDateMs = new Date().getTime()
let alreadySeenHashes = {}
// Initialize File watcher
setTimeout(() => {
    const fileWatcher = chokidar.watch(config.get("DirectoriesToWatch"), {
        ignored: /(^|[\/\\])(\.|@)./, // ignore dotfiles and @files
        persistent: true,
        ignoreInitial: false,
        usePolling: true,
        interval: 1000*config.get('pollingInterval'),
        binaryInterval: 1000*config.get('pollingInterval')
    });
    fileWatcher.on('add', async (path, stats) => {
        let pathSplit = path.split('/');
        let fileName = pathSplit.pop()
        let baseDir = "/"
        let subDir = pathSplit.join('/')
        let fileHash = await hashFile(path, stats)
        if (alreadySeenHashes[fileHash])
        {
            return Logger.ok(`Skipping file ${fileName} as hash has already been notified (${fileHash})`)
        }
        else
        {
            alreadySeenHashes[fileHash] = 1;
            Logger.info(`Flagging file hash of '${fileName}' as already been notified (${fileHash})`)
        }
        if (startDateMs > stats.ctimeMs)
        {
            return Logger.debug(`Notif skipped as file was present before start-up`);
        }
        for (let aWatchedDir of config.get("DirectoriesToWatch")) {
            if (subDir.indexOf(aWatchedDir) !== -1) {
                subDir = subDir.replace(aWatchedDir, '')
                if (subDir[0] == '/') {
                    subDir = subDir.substring(1)
                }
                baseDir = aWatchedDir
                break
            }
        }
        
        Logger.debug(`File '${fileName}' has been added to directory '${subDir}' of watched dir '${baseDir}'`);
        for (let aDiscordBot of allDiscordsBots) {
            aDiscordBot.sendNotif(baseDir, subDir, fileName, fileHash);
        }
    });
    Logger.info("Watching directories:", config.get("DirectoriesToWatch"))
}, 1000)