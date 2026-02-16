import SinesFCALogin from "."

(async() => {
  const api = await SinesFCALogin(``)

  await api.listenMqtt()
})()