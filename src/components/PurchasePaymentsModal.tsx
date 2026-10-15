import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { BankTransaction, Purchase } from '../types'
import { bankService } from '../services/bank'
import { purchaseService, summarizePayments, PAY_STATUS_LABEL, type PurchasePaymentLine } from '../services/purchases'
import { formatCurrency } from '../utils/format'

const pad = (n: number) => String(n).padStart(2, '0')
const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = (ms: number) => {
  if (!ms) return '—'
  const d = new Date(ms)
  return `${pad(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`
}

export const PAY_STATUS_BADGE: Record<string, string> = {
  paid: 'text-bg-success',
  partial: 'text-bg-warning',
  unpaid: 'text-bg-danger',
}

const SOURCE_LABEL: Record<PurchasePaymentLine['source'], string> = {
  manual: 'manual',
  bank: 'bank alert',
  'cash-close': 'cash close',
  assumed: 'assumed',
}

interface FormState {
  editingId: string | null
  amount: string
  occurredAt: string
  paidById: string
  notes: string
}

export default function PurchasePaymentsModal({
  purchase,
  txs,
  supplierName,
  payers,
  onClose,
  onChanged,
}: {
  purchase: Purchase
  txs: BankTransaction[]
  supplierName: string
  payers: { id: string; name: string }[]
  onClose: () => void
  onChanged: () => Promise<void> | void
}) {
  const summary = summarizePayments(purchase, txs)
  const [form, setForm] = useState<FormState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const payerOptions = [...payers]
  if (purchase.purchasedById && !payerOptions.some(p => p.id === purchase.purchasedById)) {
    payerOptions.push({ id: purchase.purchasedById, name: purchase.purchasedByName || 'Saved payer' })
  }

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await onChanged()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      return false
    } finally {
      setBusy(false)
    }
  }

  const openAdd = () =>
    setForm({
      editingId: null,
      amount: summary.balance > 0 ? String(summary.balance) : '',
      occurredAt: toLocalInput(new Date()),
      paidById: purchase.purchasedById || '',
      notes: '',
    })

  const openEdit = (line: PurchasePaymentLine) => {
    const tx = txs.find(t => t.id === line.id)
    setForm({
      editingId: line.id,
      amount: String(line.amount),
      occurredAt: toLocalInput(line.dateMs ? new Date(line.dateMs) : new Date()),
      paidById: tx?.paidById || purchase.purchasedById || '',
      notes: line.notes,
    })
  }

  const save = async () => {
    if (!form) return
    const amount = parseFloat(form.amount)
    const occurredAt = new Date(form.occurredAt)
    const payer = payerOptions.find(p => p.id === form.paidById)
    const ok = await run(async () => {
      if (form.editingId) {
        await bankService.updateManualPurchasePayment(form.editingId, {
          amount,
          occurredAt,
          paidById: form.paidById,
          paidByName: payer?.name,
          notes: form.notes,
        })
      } else {
        if (!purchase.paymentsTracked) await purchaseService.setPaymentsTracked(purchase.id, true)
        await bankService.createManualPurchasePayment({
          purchaseId: purchase.id,
          amount,
          occurredAt,
          notes: form.notes,
          supplierName,
          paidById: form.paidById,
          paidByName: payer?.name,
        })
      }
    })
    if (ok) setForm(null)
  }

  const remove = (line: PurchasePaymentLine) => {
    if (!window.confirm(`Delete the ${formatCurrency(line.amount)} payment by ${line.payerName}?`)) return
    void run(() => bankService.delete(line.id))
  }

  const hasRealPayments = summary.payments.some(p => p.source !== 'assumed')

  return (
    <>
      <div className="modal-backdrop fade show" />
      <div className="modal d-block" tabIndex={-1}>
        <div className="modal-dialog modal-lg modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Payments · {supplierName}</h5>
              <button className="btn-close" onClick={onClose} disabled={busy} />
            </div>
            <div className="modal-body">
              <div className="row g-2 mb-3">
                {[
                  ['Total', formatCurrency(summary.total)],
                  ['Paid', formatCurrency(summary.paid)],
                  ['Balance', formatCurrency(summary.balance)],
                ].map(([label, value]) => (
                  <div className="col-6 col-md-3" key={label}>
                    <div className="border rounded p-2 h-100">
                      <div className="small text-muted">{label}</div>
                      <div className={`fw-semibold ${label === 'Balance' && summary.balance > 0 ? 'text-danger' : ''}`}>{value}</div>
                    </div>
                  </div>
                ))}
                <div className="col-6 col-md-3 d-flex align-items-center">
                  <span className={`badge ${summary.assumed ? 'text-bg-light border' : PAY_STATUS_BADGE[summary.status]}`}>
                    {summary.assumed ? 'Assumed paid' : PAY_STATUS_LABEL[summary.status]}
                  </span>
                </div>
              </div>

              {summary.assumed && (
                <div className="alert alert-light border small d-flex flex-wrap justify-content-between align-items-center gap-2">
                  <span>
                    This bill was saved before payments were tracked, so it counts as fully paid by{' '}
                    <strong>{purchase.purchasedByName || 'its payer'}</strong>. Track the actual payments instead?
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-primary"
                    disabled={busy}
                    onClick={() => void run(() => purchaseService.setPaymentsTracked(purchase.id, true))}
                  >
                    Track actual payments
                  </button>
                </div>
              )}
              {purchase.paymentsTracked && !hasRealPayments && purchase.paymentStatus !== 'paid' && (
                <div className="small text-muted mb-2">
                  No payments recorded yet.{' '}
                  <button
                    type="button"
                    className="btn btn-link btn-sm p-0 align-baseline"
                    disabled={busy}
                    onClick={() => void run(() => purchaseService.setPaymentsTracked(purchase.id, false))}
                  >
                    Treat as fully paid by {purchase.purchasedByName || 'its payer'}
                  </button>
                </div>
              )}

              {hasRealPayments && (
                <div className="table-responsive mb-3">
                  <table className="table table-sm align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Date</th>
                        <th className="text-end">Amount</th>
                        <th>Paid by</th>
                        <th>Note</th>
                        <th>Source</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.payments.filter(p => p.source !== 'assumed').map(p => (
                        <tr key={p.id}>
                          <td className="text-nowrap">{dayLabel(p.dateMs)}</td>
                          <td className="text-end fw-semibold">{formatCurrency(p.amount)}</td>
                          <td>{p.payerName}</td>
                          <td className="small">{p.notes || '—'}</td>
                          <td className="small text-muted">{SOURCE_LABEL[p.source]}</td>
                          <td className="text-end text-nowrap">
                            {p.source === 'manual' ? (
                              <>
                                <button type="button" className="btn btn-sm btn-outline-primary me-1" disabled={busy} onClick={() => openEdit(p)}>Edit</button>
                                <button type="button" className="btn btn-sm btn-outline-danger" disabled={busy} onClick={() => remove(p)}>Delete</button>
                              </>
                            ) : (
                              <Link to="/bank" className="small">Bank</Link>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {form ? (
                <div className="border rounded p-3">
                  <div className="fw-semibold mb-2">{form.editingId ? 'Edit payment' : 'Add payment'}</div>
                  <div className="row g-2">
                    <div className="col-md-3">
                      <label className="form-label small mb-0">Amount (₹)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="form-control form-control-sm"
                        value={form.amount}
                        onChange={e => setForm({ ...form, amount: e.target.value })}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label small mb-0">Date</label>
                      <input
                        type="datetime-local"
                        className="form-control form-control-sm"
                        value={form.occurredAt}
                        onChange={e => setForm({ ...form, occurredAt: e.target.value })}
                      />
                    </div>
                    <div className="col-md-5">
                      <label className="form-label small mb-0">Paid by</label>
                      <select
                        className="form-select form-select-sm"
                        value={form.paidById}
                        onChange={e => setForm({ ...form, paidById: e.target.value })}
                      >
                        <option value="">Select who paid…</option>
                        {payerOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div className="col-12">
                      <label className="form-label small mb-0">Note (optional)</label>
                      <input
                        className="form-control form-control-sm"
                        value={form.notes}
                        placeholder="Cash / UPI ref…"
                        onChange={e => setForm({ ...form, notes: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="d-flex gap-2 mt-2">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busy || !(parseFloat(form.amount) > 0) || !form.paidById}
                      onClick={() => void save()}
                    >
                      {busy ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={() => setForm(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button type="button" className="btn btn-outline-primary btn-sm" disabled={busy} onClick={openAdd}>
                  + Add payment
                </button>
              )}
              {error && <div className="alert alert-danger small mt-2 mb-0">{error}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Close</button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
