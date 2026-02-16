import gradient from "gradient-string"
import chalk from "chalk"

export const gradients: { primary: any, second: any, success: any, warn: any, error: any } = {
  primary: gradient(['#7b4397', '#dc2430']),
  second: gradient(['#22c1c3', '#ce4319', '#fdbb2d']),

  success: gradient(['#22c1c3', '#fdbb2d']),
  warn: gradient(["#f12711", '#f5af19']),
  error: gradient(["#ED213A", '#93291E'])
}

export default function logger(data: string, option: "error" | "warn" | "success" | "info" | "") {
  switch (option) {
    case "error":
      console.log(`${chalk.bold(`[SinesBot-V2]`)} » ${chalk.bgRed("ERR!")} ${gradients.error(data)}`)
      break;

    case "warn":
      console.log(`${chalk.bold(`[SinesBot-V2]`)} » ${chalk.bgYellow("WARN")} ${gradients.warn(data)}`)
      break;

    case "success":
      console.log(`${chalk.bold(`[SinesBot-V2]`)} » ${chalk.bgGreen("SUCCESS")} ${gradients.success(data)}`)
      break;

    case "info": {
      console.log(`${chalk.bold(`[SinesBot-V2]`)} » ${gradients.second(data)}`)
      break;
    }

    default:
      console.log(`${chalk.bold(`[SinesBot-V2]`)} » ${gradients.primary(data)}`)
      break;
  }
}