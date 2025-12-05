import path from 'path'
import fs from 'fs'

import { TestRunner } from '@yamf/test'
import { overrideConsoleGlobally } from '../src/index.js'

overrideConsoleGlobally({
  includeLogLineNumbers: true
})

let fileSearch = process.argv[2]
if (!fileSearch) {
  console.error('Usage: node run-file.js <file-name>')
  process.exit(1)
}

// optional
let testNameSearch = process.argv[3]

const getSearchRegex = (search) => {
  if (!search) return null
  if (search.includes('*')) {
    return new RegExp(search.replace('*', '.*'))
  }
  return new RegExp(`^${search}$`)
}

function findFilesRecursiveSync(dirPath, fileSearch, fileList = []) {
  const fileRegex = getSearchRegex(fileSearch)
  const files = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const file of files) {
      const fullPath = path.join(dirPath, file.name)
      if (file.isDirectory()) {
        findFilesRecursiveSync(fullPath, fileSearch, fileList)
      } else if (fileRegex.test(file.name)) {
        fileList.push(fullPath)
      }
  }
  return fileList
}

let targetFilePath = findFilesRecursiveSync(path.join(process.cwd(), 'tests'), fileSearch)
if (targetFilePath.length === 0) {
  console.error('No files found matching the search criteria')
  process.exit(1)
}

const runner = new TestRunner()
for (const filePath of targetFilePath) {
  let testNameRegex = getSearchRegex(testNameSearch)
  let tests = await import(path.resolve(process.cwd(), filePath))
  let suiteName = path.basename(filePath, path.extname(filePath))
  if (testNameRegex) {
    for (let testName in tests) {
      if (testNameRegex.test(testName)) {
        tests[testName].solo = true
      }
    }
  }
  runner.addSuite(suiteName, tests)
}

runner.run()
  .then(() => process.exit(0))
  .catch(err => process.exit(err.code || 1))