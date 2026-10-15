import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  addDoc,
  query,
  where,
  orderBy,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
  limit,
} from 'firebase/firestore'
import { createHash } from '../utils/hash'
import { db, auth } from '../firebase/config'
import {
  BankTransaction,
  BankTxStatus,
  BankMatchType,
  BankDirection,
  BankBooks,
  BankSource,
  BankPaymentKind,
  BankExpenseKind,
  BankTagReason,
  DEFAULT_BANK_TAGS,
  DEFAULT_BANK_CATEGORIES,
  Order,
  Purchase,
} from '../types'
import { orderService } from './orders'
import { advancesService } from './advances'

function actorId() {
  return auth.currentUser?.uid ?? ''
}

const AMOUNT_TOLERANCE = 1

function normalizeBooks(tx: BankTransaction): BankBooks {
  return tx.books ?? 'unassigned'
}

function normalizeTx(id: string, data: Record<string, unknown>): BankTransaction {
  return {
    id,
    ...(data as Omit<BankTransaction, 'id'>),
    books: (data.books as BankBooks) ?? 'unassigned',
    personalCategory: (data.personalCategory as string | null) ?? null,
    category: (data.category as string | null) ?? (data.personalCategory as string | null) ?? null,
    workerId: (data.workerId as string | null) ?? null,
    orderId: (data.orderId as string | null) ?? null,
    purchaseId: (data.purchaseId as string | null) ?? null,
    materialId: (data.materialId as string | null) ?? null,
    productId: (data.productId as string | null) ?? null,
    paymentKind: (data.paymentKind as BankPaymentKind | null) ?? null,
    expenseKind: (data.expenseKind as BankExpenseKind | null) ?? null,
    workerPayKind: (data.workerPayKind as BankTransaction['workerPayKind']) ?? null,
    tags: (data.tags as string[]) ?? [],
  }
}

export type TagBusinessInput = {
  reason: BankTagReason
  /** Customer payment */
  paymentKind?: BankPaymentKind
  orderId?: string | null
  markOrderCompleted?: boolean
  /** Logistics */
  logisticsCompany?: string
  /** Worker */
  workerId?: string | null
  workerName?: string
  workerPayKind?: 'payout' | 'out' | 'spend'
  /** Purchase */
  purchaseId?: string | null
  /** Other / shared */
  category?: string | null
}

export const bankService = {
  async getAll(opts?: {
    status?: BankTxStatus
    direction?: BankDirection
    max?: number
  }): Promise<BankTransaction[]> {
    const constraints = []
    if (opts?.status) constraints.push(where('status', '==', opts.status))
    if (opts?.direction) constraints.push(where('direction', '==', opts.direction))
    constraints.push(orderBy('occurredAt', 'desc'))
    if (opts?.max) constraints.push(limit(opts.max))

    try {
      const snap = await getDocs(query(collection(db, 'bankTransactions'), ...constraints))
      return snap.docs.map(d => normalizeTx(d.id, d.data()))
    } catch {
      const snap = await getDocs(collection(db, 'bankTransactions'))
      let rows = snap.docs.map(d => normalizeTx(d.id, d.data()))
      if (opts?.status) rows = rows.filter(r => r.status === opts.status)
      if (opts?.direction) rows = rows.filter(r => r.direction === opts.direction)
      rows.sort((a, b) => (b.occurredAt?.toMillis?.() ?? 0) - (a.occurredAt?.toMillis?.() ?? 0))
      if (opts?.max) rows = rows.slice(0, opts.max)
      return rows
    }
  },

  async getById(id: string): Promise<BankTransaction | null> {
    const snap = await getDoc(doc(db, 'bankTransactions', id))
    if (!snap.exists()) return null
    return normalizeTx(snap.id, snap.data())
  },

  async setBooks(id: string, books: 'unassigned' | 'business'): Promise<void> {
    await updateDoc(doc(db, 'bankTransactions', id), {
      books,
      personalCategory: null,
      status: books === 'unassigned' ? 'pending' : 'reviewed',
      updatedAt: serverTimestamp(),
      reviewedBy: actorId(),
    })
  },

  async setPersonal(id: string, personalCategory: string): Promise<void> {
    const cat = personalCategory.trim().toLowerCase()
    if (!cat) throw new Error('Personal category required')
    await updateDoc(doc(db, 'bankTransactions', id), {
      books: 'personal',
      personalCategory: cat,
      category: cat,
      matchType: null,
      matchId: null,
      status: 'reviewed',
      updatedAt: serverTimestamp(),
      reviewedBy: actorId(),
    })
    await this.rememberCategory(cat)
  },

  async setLinks(
    id: string,
    links: {
      books?: BankBooks
      category?: string | null
      workerId?: string | null
      workerName?: string
      orderId?: string | null
      purchaseId?: string | null
      materialId?: string | null
      productId?: string | null
      postAdvance?: 'out' | 'spend' | null
    },
  ): Promise<void> {
    const cat = links.category?.trim().toLowerCase() || null
    const patch: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
      reviewedBy: actorId(),
    }
    if (links.books) patch.books = links.books
    if (links.category !== undefined) {
      patch.category = cat
      patch.personalCategory = links.books === 'personal' ? cat : null
    }
    if (links.workerId !== undefined) patch.workerId = links.workerId
    if (links.orderId !== undefined) patch.orderId = links.orderId
    if (links.purchaseId !== undefined) patch.purchaseId = links.purchaseId
    if (links.materialId !== undefined) patch.materialId = links.materialId
    if (links.productId !== undefined) patch.productId = links.productId

    // Classify as reviewed when assigned to personal/business (unless already matched/ignored).
    if (links.books === 'personal' || links.books === 'business') {
      patch.status = 'reviewed'
    } else if (links.books === 'unassigned') {
      patch.status = 'pending'
    }

    await updateDoc(doc(db, 'bankTransactions', id), patch)
    if (cat) await this.rememberCategory(cat)

    if (links.postAdvance && links.workerId) {
      const tx = await this.getById(id)
      if (tx && tx.amount > 0) {
        await advancesService.addEntry({
          workerId: links.workerId,
          workerName: links.workerName || links.workerId,
          kind: links.postAdvance,
          amount: tx.amount,
          bankTransactionId: id,
          materialId: links.materialId ?? tx.materialId,
          orderId: links.orderId ?? tx.orderId,
          category: cat || tx.category,
          occurredAt: tx.occurredAt?.toDate?.(),
        })
      }
    }
  },

  async setTags(id: string, tags: string[]): Promise<void> {
    const cleaned = [...new Set(tags.map(t => t.trim().toLowerCase()).filter(Boolean))]
    await updateDoc(doc(db, 'bankTransactions', id), {
      tags: cleaned,
      updatedAt: serverTimestamp(),
      reviewedBy: actorId(),
    })
    await this.rememberTags(cleaned)
  },

  async updateDetails(id: string, data: {
    occurredAt: Date
    amount: number
    direction: BankDirection
    description: string
    counterparty: string
  }): Promise<void> {
    await updateDoc(doc(db, 'bankTransactions', id), {
      occurredAt: Timestamp.fromDate(data.occurredAt),
      amount: data.amount,
      direction: data.direction,
      description: data.description.trim(),
      counterparty: data.counterparty.trim(),
      updatedAt: serverTimestamp(),
      reviewedBy: actorId(),
    })
  },

  async delete(id: string): Promise<void> {
    await deleteDoc(doc(db, 'bankTransactions', id))
  },

  async ignore(id: string): Promise<void> {
    await updateDoc(doc(db, 'bankTransactions', id), {
      status: 'ignored',
      matchType: null,
      matchId: null,
      updatedAt: serverTimestamp(),
      reviewedBy: actorId(),
    })
  },

  async unignore(id: string): Promise<void> {
    await updateDoc(doc(db, 'bankTransactions', id), {
      status: 'pending',
      updatedAt: serverTimestamp(),
      reviewedBy: actorId(),
    })
  },

  async match(
    id: string,
    matchType: BankMatchType,
    matchId: string,
    opts?: { markOrderCompleted?: boolean },
  ): Promise<void> {
    await updateDoc(doc(db, 'bankTransactions', id), {
      status: 'matched',
      books: 'business',
      personalCategory: null,
      matchType,
      matchId,
      ...(matchType === 'order' ? { orderId: matchId } : { purchaseId: matchId }),
      updatedAt: serverTimestamp(),
      reviewedBy: actorId(),
    })
    if (matchType === 'order' && opts?.markOrderCompleted) {
      await orderService.updateStatus(matchId, 'COMPLETED')
    }
  },

  async unmatch(id: string): Promise<void> {
    await updateDoc(doc(db, 'bankTransactions', id), {
      status: 'pending',
      matchType: null,
      matchId: null,
      paymentKind: null,
      expenseKind: null,
      workerPayKind: null,
      updatedAt: serverTimestamp(),
      reviewedBy: actorId(),
    })
  },

  /**
   * Unified business tagging (replaces Match + Link for business flows).
   */
  async tagBusiness(id: string, input: TagBusinessInput): Promise<void> {
    const tx = await this.getById(id)
    if (!tx) throw new Error('Transaction not found')

    if (input.reason === 'ignore') {
      await this.ignore(id)
      return
    }

    const cat = input.category?.trim().toLowerCase() || null
    const base = {
      books: 'business' as const,
      personalCategory: null,
      updatedAt: serverTimestamp(),
      reviewedBy: actorId(),
    }

    if (input.reason === 'customer_payment') {
      const orderId = input.orderId?.trim()
      if (!orderId) throw new Error('Order is required for customer payment')
      const paymentKind = input.paymentKind || 'advance'
      await updateDoc(doc(db, 'bankTransactions', id), {
        ...base,
        status: 'matched',
        matchType: 'order',
        matchId: orderId,
        orderId,
        purchaseId: null,
        paymentKind,
        expenseKind: null,
        workerPayKind: null,
        workerId: null,
        category: cat || paymentKind,
      })
      if (cat || paymentKind) await this.rememberCategory(cat || paymentKind)
      if (input.markOrderCompleted) {
        await orderService.updateStatus(orderId, 'COMPLETED')
      }
      return
    }

    if (input.reason === 'logistics') {
      const orderId = input.orderId?.trim()
      if (!orderId) throw new Error('Order is required for logistics')
      await updateDoc(doc(db, 'bankTransactions', id), {
        ...base,
        status: 'matched',
        matchType: 'order',
        matchId: orderId,
        orderId,
        purchaseId: null,
        paymentKind: null,
        expenseKind: 'logistics',
        workerPayKind: null,
        category: cat || 'shipping',
      })
      await this.rememberCategory(cat || 'shipping')

      const order = await orderService.getById(orderId)
      const ship = order?.shipment
      const company = (input.logisticsCompany || ship?.logisticsCompany || '').trim()
      const cost =
        ship?.cost != null && Number(ship.cost) > 0 ? Number(ship.cost) : Number(tx.amount)
      await orderService.updateShipment(orderId, {
        logisticsCompany: company,
        trackingId: ship?.trackingId || '',
        cost,
        photoUrls: ship?.photoUrls || [],
        bankTransactionId: id,
      })
      return
    }

    if (input.reason === 'purchase') {
      const purchaseId = input.purchaseId?.trim()
      if (!purchaseId) throw new Error('Purchase is required')
      await updateDoc(doc(db, 'bankTransactions', id), {
        ...base,
        status: 'matched',
        matchType: 'purchase',
        matchId: purchaseId,
        purchaseId,
        orderId: null,
        paymentKind: null,
        expenseKind: null,
        workerPayKind: null,
        category: cat || 'materials',
      })
      if (cat) await this.rememberCategory(cat)
      return
    }

    if (input.reason === 'recce') {
      const workerId = input.workerId?.trim() || null
      await updateDoc(doc(db, 'bankTransactions', id), {
        ...base,
        status: workerId ? 'matched' : 'reviewed',
        matchType: null,
        matchId: null,
        orderId: null,
        purchaseId: null,
        paymentKind: null,
        expenseKind: 'recce',
        workerId,
        workerPayKind: workerId ? 'spend' : null,
        category: cat || 'recce',
      })
      await this.rememberCategory(cat || 'recce')
      if (workerId && tx.amount > 0) {
        await advancesService.addEntry({
          workerId,
          workerName: input.workerName || workerId,
          kind: 'spend',
          amount: tx.amount,
          bankTransactionId: id,
          category: cat || 'recce',
          occurredAt: tx.occurredAt?.toDate?.(),
        })
      }
      return
    }

    if (input.reason === 'worker') {
      const workerId = input.workerId?.trim()
      if (!workerId) throw new Error('Worker is required')
      const payKind = input.workerPayKind || 'payout'
      const orderId = input.orderId?.trim() || null
      const status =
        payKind === 'payout' && orderId ? 'matched' : payKind === 'payout' ? 'reviewed' : 'reviewed'
      await updateDoc(doc(db, 'bankTransactions', id), {
        ...base,
        status: orderId && payKind === 'payout' ? 'matched' : status,
        matchType: orderId && payKind === 'payout' ? 'order' : null,
        matchId: orderId && payKind === 'payout' ? orderId : null,
        orderId,
        purchaseId: null,
        paymentKind: null,
        expenseKind: null,
        workerId,
        workerPayKind: payKind,
        category: cat || (payKind === 'payout' ? 'payout' : payKind === 'out' ? 'advance' : 'worker-spend'),
      })
      await this.rememberCategory(
        cat || (payKind === 'payout' ? 'payout' : payKind === 'out' ? 'advance' : 'worker-spend'),
      )
      if ((payKind === 'out' || payKind === 'spend') && tx.amount > 0) {
        await advancesService.addEntry({
          workerId,
          workerName: input.workerName || workerId,
          kind: payKind,
          amount: tx.amount,
          bankTransactionId: id,
          orderId,
          category: cat || (payKind === 'out' ? 'advance' : 'worker-spend'),
          occurredAt: tx.occurredAt?.toDate?.(),
        })
      }
      return
    }

    if (input.reason === 'other') {
      await updateDoc(doc(db, 'bankTransactions', id), {
        ...base,
        status: 'reviewed',
        matchType: null,
        matchId: null,
        paymentKind: null,
        expenseKind: null,
        workerPayKind: null,
        category: cat || 'other',
      })
      if (cat) await this.rememberCategory(cat)
      return
    }

    throw new Error('Unknown tag reason')
  },

  async listByOrderId(orderId: string): Promise<BankTransaction[]> {
    try {
      const snap = await getDocs(
        query(collection(db, 'bankTransactions'), where('orderId', '==', orderId)),
      )
      return snap.docs
        .map(d => normalizeTx(d.id, d.data()))
        .sort((a, b) => (b.occurredAt?.toMillis?.() ?? 0) - (a.occurredAt?.toMillis?.() ?? 0))
    } catch {
      const all = await this.getAll({ max: 500 })
      return all.filter(t => t.orderId === orderId)
    }
  },

  async listByPurchaseId(purchaseId: string): Promise<BankTransaction[]> {
    try {
      const snap = await getDocs(
        query(collection(db, 'bankTransactions'), where('purchaseId', '==', purchaseId)),
      )
      return snap.docs
        .map(d => normalizeTx(d.id, d.data()))
        .sort((a, b) => (b.occurredAt?.toMillis?.() ?? 0) - (a.occurredAt?.toMillis?.() ?? 0))
    } catch {
      const all = await this.getAll({ max: 500 })
      return all.filter(t => t.purchaseId === purchaseId)
    }
  },

  async createImportRow(params: {
    occurredAt: Date
    amount: number
    direction?: BankDirection
    description: string
    category?: string | null
    workerId?: string | null
    workerName?: string
    orderId?: string | null
    materialId?: string | null
    productId?: string | null
    notes?: string
    postAdvance?: 'out' | 'spend' | null
  }): Promise<{ id: string; skipped: boolean }> {
    const amount = Math.abs(Number(params.amount))
    const direction = params.direction ?? 'debit'
    const occurredIso = params.occurredAt.toISOString().slice(0, 10)
    const fpBase = [
      'import',
      occurredIso,
      direction,
      amount.toFixed(2),
      params.workerId || '',
      params.description.slice(0, 80),
    ].join('|')
    const fingerprint = createHash(fpBase)
    const gmailMessageId = `import:${fingerprint}`

    const existing = await getDocs(
      query(
        collection(db, 'bankTransactions'),
        where('gmailMessageId', '==', gmailMessageId),
        where('fingerprint', '==', fingerprint),
        limit(1),
      ),
    )
    if (!existing.empty) return { id: existing.docs[0].id, skipped: true }

    const cat = params.category?.trim().toLowerCase() || null
    const ref = await addDoc(collection(db, 'bankTransactions'), {
      gmailMessageId,
      gmailThreadId: '',
      fingerprint,
      source: 'import' as BankSource,
      occurredAt: Timestamp.fromDate(params.occurredAt),
      amount,
      direction,
      currency: 'INR',
      bankName: null,
      accountLast4: null,
      counterparty: params.workerName || null,
      description: params.description,
      rawSubject: params.notes || '',
      snippet: '',
      parseConfidence: 1,
      parseNotes: 'Imported from spreadsheet',
      status: 'pending',
      books: 'business',
      personalCategory: null,
      category: cat,
      workerId: params.workerId ?? null,
      orderId: params.orderId ?? null,
      purchaseId: null,
      materialId: params.materialId ?? null,
      productId: params.productId ?? null,
      tags: [],
      matchType: null,
      matchId: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      reviewedBy: actorId(),
    })

    if (cat) await this.rememberCategory(cat)

    if (params.postAdvance && params.workerId) {
      await advancesService.addEntry({
        workerId: params.workerId,
        workerName: params.workerName || params.workerId,
        kind: params.postAdvance,
        amount,
        bankTransactionId: ref.id,
        materialId: params.materialId,
        orderId: params.orderId,
        category: cat,
        notes: params.notes,
        occurredAt: params.occurredAt,
      })
    }

    return { id: ref.id, skipped: false }
  },

  /** Cash/UPI etc. recorded on an order without bank-alert tagging. */
  async createManualCustomerPayment(params: {
    orderId: string
    amount: number
    paymentKind: BankPaymentKind
    occurredAt: Date
    notes?: string
  }): Promise<string> {
    const orderId = params.orderId.trim()
    if (!orderId) throw new Error('Order is required')
    const amount = Math.abs(Number(params.amount))
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be greater than 0')
    const paymentKind: BankPaymentKind = params.paymentKind === 'final' ? 'final' : 'advance'
    const occurredAt = params.occurredAt instanceof Date ? params.occurredAt : new Date(params.occurredAt)
    if (Number.isNaN(occurredAt.getTime())) throw new Error('Invalid payment date')

    const fingerprint = createHash(
      ['manual', orderId, paymentKind, amount.toFixed(2), occurredAt.toISOString(), String(Date.now())].join('|'),
    )
    const shortId = orderId.slice(0, 6).toUpperCase()
    const notes = params.notes?.trim() || ''

    const ref = await addDoc(collection(db, 'bankTransactions'), {
      gmailMessageId: `manual:${fingerprint}`,
      gmailThreadId: '',
      fingerprint,
      source: 'manual' as BankSource,
      occurredAt: Timestamp.fromDate(occurredAt),
      amount,
      direction: 'credit' as BankDirection,
      currency: 'INR',
      bankName: null,
      accountLast4: null,
      counterparty: null,
      description: `Manual payment · ${shortId} · ${paymentKind}`,
      rawSubject: notes,
      snippet: '',
      parseConfidence: 1,
      parseNotes: 'Manual payment from order detail',
      status: 'matched',
      books: 'business',
      personalCategory: null,
      category: paymentKind,
      workerId: null,
      orderId,
      purchaseId: null,
      materialId: null,
      productId: null,
      paymentKind,
      expenseKind: null,
      workerPayKind: null,
      tags: [],
      matchType: 'order' as BankMatchType,
      matchId: orderId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      reviewedBy: actorId(),
    })

    await this.rememberCategory(paymentKind)
    return ref.id
  },

  /** Cash paid for a purchase, when it never arrived as a bank alert. */
  async createManualPurchasePayment(params: {
    purchaseId: string
    amount: number
    occurredAt: Date
    notes?: string
    supplierName?: string
    paidById?: string
    paidByName?: string
  }): Promise<string> {
    const purchaseId = params.purchaseId.trim()
    if (!purchaseId) throw new Error('Purchase is required')
    const amount = Math.abs(Number(params.amount))
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be greater than 0')
    const occurredAt = params.occurredAt instanceof Date ? params.occurredAt : new Date(params.occurredAt)
    if (Number.isNaN(occurredAt.getTime())) throw new Error('Invalid payment date')

    const fingerprint = createHash(
      ['manual-purchase', purchaseId, amount.toFixed(2), occurredAt.toISOString(), String(Date.now())].join('|'),
    )
    const who = params.supplierName?.trim() || purchaseId.slice(0, 6).toUpperCase()
    const notes = params.notes?.trim() || ''

    const ref = await addDoc(collection(db, 'bankTransactions'), {
      gmailMessageId: `manual:${fingerprint}`,
      gmailThreadId: '',
      fingerprint,
      source: 'manual' as BankSource,
      occurredAt: Timestamp.fromDate(occurredAt),
      amount,
      direction: 'debit' as BankDirection,
      currency: 'INR',
      bankName: null,
      accountLast4: null,
      counterparty: who,
      description: `Cash · ${who}`,
      rawSubject: notes,
      snippet: '',
      parseConfidence: 1,
      parseNotes: 'Cash payment from purchase',
      status: 'matched',
      books: 'business',
      personalCategory: null,
      category: 'materials',
      workerId: null,
      orderId: null,
      purchaseId,
      paidById: params.paidById || null,
      paidByName: params.paidByName?.trim() || null,
      materialId: null,
      productId: null,
      paymentKind: null,
      expenseKind: null,
      workerPayKind: null,
      tags: [],
      matchType: 'purchase' as BankMatchType,
      matchId: purchaseId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      reviewedBy: actorId(),
    })

    await this.rememberCategory('materials')
    return ref.id
  },

  async updateManualPurchasePayment(id: string, params: {
    amount: number
    occurredAt: Date
    paidById?: string
    paidByName?: string
    notes?: string
  }): Promise<void> {
    const amount = Math.abs(Number(params.amount))
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Amount must be greater than 0')
    if (Number.isNaN(params.occurredAt.getTime())) throw new Error('Invalid payment date')
    await updateDoc(doc(db, 'bankTransactions', id), {
      amount,
      occurredAt: Timestamp.fromDate(params.occurredAt),
      paidById: params.paidById || null,
      paidByName: params.paidByName?.trim() || null,
      rawSubject: params.notes?.trim() || '',
      updatedAt: serverTimestamp(),
      reviewedBy: actorId(),
    })
  },

  /** Every ledger row paying a purchase: manual, tagged bank alerts and cash closes. */
  async listPurchasePayments(): Promise<BankTransaction[]> {
    try {
      const snap = await getDocs(query(collection(db, 'bankTransactions'), where('matchType', '==', 'purchase')))
      return snap.docs.map(d => normalizeTx(d.id, d.data()))
    } catch {
      const all = await this.getAll()
      return all.filter(t => t.matchType === 'purchase')
    }
  },

  async getKnownTags(): Promise<string[]> {
    const snap = await getDoc(doc(db, 'meta', 'bankTags'))
    const stored = snap.exists() ? ((snap.data()?.names as string[]) ?? []) : []
    return [...new Set([...DEFAULT_BANK_TAGS, ...stored])].sort()
  },

  async rememberTags(tags: string[]): Promise<void> {
    if (!tags.length) return
    const ref = doc(db, 'meta', 'bankTags')
    const snap = await getDoc(ref)
    const existing = snap.exists() ? ((snap.data()?.names as string[]) ?? []) : []
    const names = [...new Set([...existing, ...tags.map(t => t.toLowerCase())])]
    await setDoc(ref, { names, updatedAt: serverTimestamp() }, { merge: true })
  },

  async getCategories(): Promise<string[]> {
    const snap = await getDoc(doc(db, 'meta', 'bankCategories'))
    const stored = snap.exists() ? ((snap.data()?.names as string[]) ?? []) : []
    const legacy = await getDoc(doc(db, 'meta', 'personalCategories'))
    const legacyNames = legacy.exists() ? ((legacy.data()?.names as string[]) ?? []) : []
    return [...new Set([...DEFAULT_BANK_CATEGORIES, ...stored, ...legacyNames])].sort()
  },

  /** Alias used by older Bank UI */
  async getPersonalCategories(): Promise<string[]> {
    return this.getCategories()
  },

  async rememberCategory(category: string): Promise<void> {
    const cat = category.trim().toLowerCase()
    if (!cat) return
    const ref = doc(db, 'meta', 'bankCategories')
    const snap = await getDoc(ref)
    const existing = snap.exists() ? ((snap.data()?.names as string[]) ?? []) : []
    const names = [...new Set([...DEFAULT_BANK_CATEGORIES, ...existing, cat])]
    await setDoc(ref, { names, updatedAt: serverTimestamp() }, { merge: true })
  },

  async rememberPersonalCategory(category: string): Promise<void> {
    return this.rememberCategory(category)
  },

  async saveCategories(names: string[]): Promise<string[]> {
    const cleaned = [...new Set(names.map(n => n.trim().toLowerCase()).filter(Boolean))]
    await setDoc(
      doc(db, 'meta', 'bankCategories'),
      { names: cleaned, updatedAt: serverTimestamp() },
      { merge: true },
    )
    return [...new Set([...DEFAULT_BANK_CATEGORIES, ...cleaned])].sort()
  },

  booksOf(tx: BankTransaction): BankBooks {
    return normalizeBooks(tx)
  },

  /** High-level tag reason for filters / reports */
  reasonKind(
    tx: BankTransaction,
  ): 'customer' | 'logistics' | 'recce' | 'worker' | 'purchase' | 'other' {
    if (tx.paymentKind === 'advance' || tx.paymentKind === 'final') return 'customer'
    if (tx.expenseKind === 'logistics') return 'logistics'
    if (tx.expenseKind === 'recce') return 'recce'
    if (tx.workerPayKind || tx.workerId) return 'worker'
    if (tx.purchaseId || tx.matchType === 'purchase' || (tx.purchaseIds && tx.purchaseIds.length > 0)) return 'purchase'
    return 'other'
  },

  suggestOrderMatches(tx: BankTransaction, orders: Order[]): Order[] {
    if (tx.direction !== 'credit') return []
    if (normalizeBooks(tx) === 'personal') return []
    const amount = Number(tx.amount)
    return orders
      .filter(o => o.status !== 'COMPLETED' && o.status !== 'CANCELLED')
      .filter(o => {
        const total = Number(o.grandTotal ?? o.total ?? 0)
        return Math.abs(total - amount) <= AMOUNT_TOLERANCE
      })
      .slice(0, 8)
  },

  suggestPurchaseMatches(tx: BankTransaction, purchases: Purchase[]): Purchase[] {
    if (tx.direction !== 'debit') return []
    if (normalizeBooks(tx) === 'personal') return []
    const amount = Number(tx.amount)
    return purchases
      .filter(p => p.status === 'COMPLETED')
      .filter(p => {
        const total = Number(p.grandTotal ?? p.total ?? 0)
        return Math.abs(total - amount) <= AMOUNT_TOLERANCE
      })
      .slice(0, 8)
  },

  /** Personal books summary for the rows you pass (already date/filter scoped). */
  personalSummary(txs: BankTransaction[]) {
    const personal = txs.filter(t => normalizeBooks(t) === 'personal')
    let credits = 0
    let debits = 0
    const byCategory: Record<string, { credits: number; debits: number }> = {}
    for (const t of personal) {
      const cat = t.category || t.personalCategory || 'other'
      if (!byCategory[cat]) byCategory[cat] = { credits: 0, debits: 0 }
      if (t.direction === 'credit') {
        credits += t.amount
        byCategory[cat].credits += t.amount
      } else {
        debits += t.amount
        byCategory[cat].debits += t.amount
      }
    }
    return { credits, debits, net: credits - debits, byCategory, count: personal.length }
  },

  /** @deprecated Prefer personalSummary with pre-filtered rows */
  personalMonthSummary(txs: BankTransaction[], now = new Date()) {
    const y = now.getFullYear()
    const m = now.getMonth()
    const inMonth = txs.filter(t => {
      const d = t.occurredAt?.toDate?.()
      if (!d) return false
      return d.getFullYear() === y && d.getMonth() === m
    })
    return this.personalSummary(inMonth)
  },

  /**
   * Summarize bank rows (optionally already filtered to a date range).
   * Ignored rows are excluded from money totals but counted in rowCount.
   */
  summarizeRange(rows: BankTransaction[]): BankCashSummary {
    const summary: BankCashSummary = {
      businessIn: 0,
      businessOut: 0,
      personalCredits: 0,
      personalDebits: 0,
      personalNet: 0,
      customerPayments: 0,
      logistics: 0,
      recce: 0,
      workerFloatOut: 0,
      workerFloatSpend: 0,
      rowCount: rows.length,
    }
    for (const t of rows) {
      if (t.status === 'ignored') continue
      const books = normalizeBooks(t)
      const amount = Number(t.amount) || 0
      if (books === 'business') {
        if (t.direction === 'credit') summary.businessIn += amount
        else summary.businessOut += amount
      }
      if (books === 'personal') {
        if (t.direction === 'credit') summary.personalCredits += amount
        else summary.personalDebits += amount
      }
      if (
        (t.paymentKind === 'advance' || t.paymentKind === 'final') &&
        t.direction === 'credit'
      ) {
        summary.customerPayments += amount
      }
      if (t.expenseKind === 'logistics' && t.direction === 'debit') summary.logistics += amount
      if (t.expenseKind === 'recce') summary.recce += amount
      if (t.workerPayKind === 'out') summary.workerFloatOut += amount
      if (t.workerPayKind === 'spend') summary.workerFloatSpend += amount
    }
    summary.personalNet = summary.personalCredits - summary.personalDebits
    return summary
  },

  /**
   * Live Bank page dashboard from the rows you pass (already filter/date scoped).
   * Call with the same set the grid uses so tiles stay in sync with filters.
   */
  dashboardSnapshot(txs: BankTransaction[]): BankDashboardSnapshot {
    const pendingReview = txs.filter(t => t.status === 'pending').length
    const untagged = txs.filter(
      t => t.status !== 'ignored' && normalizeBooks(t) === 'unassigned',
    ).length
    const needsAttention = [...txs]
      .filter(
        t =>
          t.status !== 'ignored' &&
          (t.status === 'pending' || normalizeBooks(t) === 'unassigned'),
      )
      .sort((a, b) => (b.occurredAt?.toMillis?.() ?? 0) - (a.occurredAt?.toMillis?.() ?? 0))
      .slice(0, 8)

    return {
      totals: this.summarizeRange(txs),
      /** @deprecated use totals */
      month: this.summarizeRange(txs),
      pendingReview,
      untagged,
      needsAttention,
    }
  },
}

export interface BankCashSummary {
  businessIn: number
  businessOut: number
  personalCredits: number
  personalDebits: number
  personalNet: number
  customerPayments: number
  logistics: number
  recce: number
  workerFloatOut: number
  workerFloatSpend: number
  rowCount: number
}

export interface BankDashboardSnapshot {
  totals: BankCashSummary
  /** @deprecated alias of totals */
  month: BankCashSummary
  pendingReview: number
  untagged: number
  needsAttention: BankTransaction[]
}
