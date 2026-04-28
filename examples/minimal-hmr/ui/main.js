const out = document.getElementById('out')
fetch('/api/ping', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ op: 'ping' })
})
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
  .then((j) => {
    out.textContent = JSON.stringify(j, null, 2) + ' NIFTY'
  })
  .catch((e) => {
    out.textContent = `Error: ${e.message}

Start yamf init --dev, gateway, yamf build && yamf deploy (see README).`
  })
