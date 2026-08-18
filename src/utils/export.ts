import * as XLSX from 'xlsx'

export function parseSpreadsheet(file: File): Promise<Record<string, string>[]> {
  return file.arrayBuffer().then(buf => {
    const wb = XLSX.read(buf, { type: 'array' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    return rows.map(row => {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(row)) {
        out[String(k).trim().toLowerCase().replace(/\s+/g, ' ')] = String(v ?? '').trim()
      }
      return out
    })
  })
}

export function exportToCSV(data: Record<string, unknown>[], filename: string): void {
  const ws = XLSX.utils.json_to_sheet(data)
  const csv = XLSX.utils.sheet_to_csv(ws)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function exportToExcel(data: Record<string, unknown>[], filename: string): void {
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, `${filename}.xlsx`)
}
