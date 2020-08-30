module Logger {
    // Public
    export function error(...args:any[]) {
        log(ColorFgRed,    "ERROR",  ...args);
    }
    export function warning(...args:any[]) {
        log(ColorFgYellow, "WARNING", ...args);
    }
    export function info(...args:any[]) {
        log(ColorFgCyan,   "INFO",   ...args);
    }
    export function ok(...args:any[]) {
        log(ColorFgGreen,  "OK",   ...args);
    }
    export function debug(...args:any[]) {
        log(ColorFgWhite,  "DEBUG",  ...args);
    }

    // Private
    function getTimestamp() {
        var d = new Date();
        return new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '').replace(/-/g, '/');
    }
    function log(colorData:string, prefix:string, ...args:any[]) {
        console.log(colorData + getTimestamp()+" | "+prefix+" -", ...args, ColorReset);
    }

    const ColorReset:string = "\x1b[0m"
    const ColorBright:string = "\x1b[1m"
    const ColorDim:string = "\x1b[2m"
    const ColorUnderscore:string = "\x1b[4m"
    const ColorBlink:string = "\x1b[5m"
    const ColorReverse:string = "\x1b[7m"
    const ColorHidden:string = "\x1b[8m"
    const ColorFgBlack:string = "\x1b[30m"
    const ColorFgRed:string = "\x1b[31m"
    const ColorFgGreen:string = "\x1b[32m"
    const ColorFgYellow:string = "\x1b[33m"
    const ColorFgBlue:string = "\x1b[34m"
    const ColorFgMagenta:string = "\x1b[35m"
    const ColorFgCyan:string = "\x1b[36m"
    const ColorFgWhite:string = "\x1b[37m"
}

export default Logger