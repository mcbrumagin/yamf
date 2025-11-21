async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export { sleep }
export default { sleep }