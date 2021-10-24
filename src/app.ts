import Logger from './modules/logger.js'
import DiscordBot from './modules/discord_bot.js'
import chokidar from 'chokidar'
import config from 'config';
import hasha from 'hasha';

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

let isIgnoringNotif = true;
setTimeout(() => {
    isIgnoringNotif = false;
    Logger.info("Ignore notifs mode disabled!")
}, config.get('ignoreNotifsAtStartDuringSec')*1000);


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
        let fileHash = await hasha.fromFile(path, {algorithm: 'sha1'})
        if (alreadySeenHashes[fileHash])
        {
            Logger.debug(`Skipping file ${fileName} as hash has already been notified`)
        }
        else
        {
            alreadySeenHashes[fileHash] = 1;
            Logger.info(`Flagging file hash of '${fileName}' as already been notified`)
        }
        if (isIgnoringNotif)
        {
            Logger.debug(`Notif skipped as process is still in ignore mode`)
            return;
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
            aDiscordBot.sendNotif(baseDir, subDir, fileName);
        }
    });
    Logger.info("Watching directories:", config.get("DirectoriesToWatch"))
}, 1000)