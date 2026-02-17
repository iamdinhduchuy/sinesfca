
interface IClientToken {
  EAAG: string
  EAAB: string
}

interface IClient {
  fb_dtsg: string
  userID: string
  token: IClientToken
  lsd: string,
  jazoest: string
  lastSeqID: string
  clientID: string

  userAgent: string
  region: string
  mqttEndpoint: string
}