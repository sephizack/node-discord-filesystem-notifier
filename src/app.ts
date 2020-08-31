import Logger from './modules/logger.js'
import DiscordBot from './modules/discord_bot.js'
import chokidar from 'chokidar'
import config from 'config';

//const client = new Discord.Client();
//client.login('token');

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


// Initialize File watcher
setTimeout(() => {
    const fileWatcher = chokidar.watch(config.get("DirectoriesToWatch"), {
        ignored: /(^|[\/\\])\../, // ignore dotfiles
        persistent: true,
        ignoreInitial: true,
        usePolling: true,
        interval: 60,
    });
    fileWatcher.on('add', (path) => {
        let pathSplit = path.split('/');
        let fileName = pathSplit.pop()
        let baseDir = "/"
        let subDir = pathSplit.join('/')
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