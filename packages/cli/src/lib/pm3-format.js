/**
 * Text rendering for `yamf list` (pm3 process rows). No state; PM3 does not need to know about this.
 */

/** Tree line prefix for a child row under a parent. */
export function treeBranch (isLast) {
  return isLast ? '└── ' : '├── '
}

function sortServiceEntries (services) {
  return Object.entries(services).sort(([a], [b]) => {
    if (a === 'registry') return -1
    if (b === 'registry') return 1
    return 0
  })
}

function formatProcessesView (entries) {
  const rows = entries.map((e) => ({
    filepath: e.filepath,
    pid: e.pid || '-',
    status: e.status,
    services: e.services || {},
    started: e.startedAt ? new Date(e.startedAt).toLocaleTimeString() : '-'
  }))

  const cols = {
    pid: Math.max(5, ...rows.map((r) => String(r.pid).length)),
    status: Math.max(6, ...rows.map((r) => r.status.length)),
    started: Math.max(7, ...rows.map((r) => r.started.length)),
    filepath: Math.max(8, ...rows.map((r) => r.filepath.length))
  }

  const header = [
    'PID'.padEnd(cols.pid),
    'Status'.padEnd(cols.status),
    'Started'.padEnd(cols.started),
    'Filepath'.padEnd(cols.filepath)
  ].join('  ')

  const separator = [
    '-'.repeat(cols.pid),
    '-'.repeat(cols.status),
    '-'.repeat(cols.started),
    '-'.repeat(cols.filepath)
  ].join('  ')

  const lines = []
  for (const r of rows) {
    lines.push(
      [
        String(r.pid).padEnd(cols.pid),
        r.status.padEnd(cols.status),
        r.started.padEnd(cols.started),
        r.filepath.padEnd(cols.filepath)
      ].join('  ')
    )

    const serviceEntries = sortServiceEntries(r.services)
    for (let i = 0; i < serviceEntries.length; i++) {
      const [name, locations] = serviceEntries[i]
      const isLast = i === serviceEntries.length - 1
      const location = locations[0] || ''
      lines.push(treeBranch(isLast) + name + (location ? ` @ ${location}` : ''))
    }
  }

  return [header, separator, ...lines].join('\n')
}

function formatServicesView (entries) {
  const serviceMap = {}
  for (const e of entries) {
    for (const [name, locations] of Object.entries(e.services || {})) {
      if (!serviceMap[name]) serviceMap[name] = []
      for (const loc of locations) {
        serviceMap[name].push({ location: loc, pid: e.pid, filepath: e.filepath })
      }
    }
  }

  const names = Object.keys(serviceMap)
  if (names.length === 0) return 'No services registered.'

  const lines = []
  for (const name of names.sort()) {
    const instances = serviceMap[name]
    lines.push(name)
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i]
      const isLast = i === instances.length - 1
      lines.push(treeBranch(isLast) + inst.location + ` (PID: ${inst.pid || '-'})`)
    }
  }

  return lines.join('\n')
}

function formatLocationsView (entries) {
  const hostMap = {}
  for (const e of entries) {
    for (const [name, locations] of Object.entries(e.services || {})) {
      for (const loc of locations) {
        const host = new URL(loc).hostname
        if (!hostMap[host]) hostMap[host] = []
        hostMap[host].push({ service: name, location: loc, pid: e.pid })
      }
    }
  }

  const hosts = Object.keys(hostMap)
  if (hosts.length === 0) return 'No service locations found.'

  const lines = []
  for (const host of hosts.sort()) {
    const svcs = hostMap[host]
    lines.push(host)
    for (let i = 0; i < svcs.length; i++) {
      const s = svcs[i]
      const isLast = i === svcs.length - 1
      lines.push(treeBranch(isLast) + s.service + ` @ ${s.location}`)
    }
  }

  return lines.join('\n')
}

/**
 * @param {Array<Record<string, unknown>>} entries rows from `PM3#list` or the remote `list` wire call
 * @param {{ view?: 'processes' | 'services' | 'locations' }} [options]
 */
/**
 * @param {string} registryUrl
 * @param {Record<string, unknown>} pull - result of REGISTRY_PULL
 */
export function formatRegistryPullSection (registryUrl, pull) {
  if (!pull || typeof pull !== 'object') {
    return '(empty response)'
  }
  const services = pull.services && typeof pull.services === 'object' ? pull.services : {}
  const names = Object.keys(services).sort()
  const header =
    `--- Live registry (REGISTRY_PULL) at ${String(registryUrl).replace(/\s/g, '')} — ` +
    `${names.length} service name(s) ---`
  if (names.length === 0) {
    return `${header}\n(no services registered.)`
  }
  const lines = [header, '']
  for (const name of names) {
    const locs = Array.isArray(services[name]) ? services[name] : []
    lines.push(name)
    for (let i = 0; i < locs.length; i++) {
      lines.push(treeBranch(i === locs.length - 1) + String(locs[i]))
    }
  }
  if (pull.timestamp != null) {
    lines.push('')
    lines.push(`(pull timestamp: ${pull.timestamp})`)
  }
  return lines.join('\n')
}

export function formatPm3List (entries, { view = 'processes' } = {}) {
  if (entries.length === 0) {
    return 'No processes running.'
  }
  if (view === 'services') return formatServicesView(entries)
  if (view === 'locations') return formatLocationsView(entries)
  return formatProcessesView(entries)
}
