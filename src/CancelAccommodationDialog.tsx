import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { StopAccommodation } from './tripTypes'

type RefundChoice = 'full' | 'partial' | 'none'

type CancelAccommodationDialogProps = {
  open: boolean
  lodging: StopAccommodation | null
  onClose: () => void
  onConfirm: () => void
}

function paidHint(lodging: StopAccommodation | null): string {
  if (!lodging) return ''
  return (lodging.amountPaid || lodging.price || '').trim()
}

export function CancelAccommodationDialog({
  open,
  lodging,
  onClose,
  onConfirm,
}: CancelAccommodationDialogProps) {
  const [refundStatus, setRefundStatus] = useState<RefundChoice>('none')
  const [refundAmount, setRefundAmount] = useState('')

  useEffect(() => {
    if (!open) return
    setRefundStatus('none')
    setRefundAmount('')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !lodging) return null

  const name = (lodging.name || lodging.confirmationRef || 'This accommodation').trim()
  const paid = paidHint(lodging)
  const paidLine: ReactNode = paid ? (
    <p className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
      Recorded payment: <span className="font-semibold">{paid}</span>
    </p>
  ) : (
    <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">No payment amount on file.</p>
  )

  const options: Array<{ value: RefundChoice; label: string }> = [
    { value: 'full', label: paid ? `Full refund (${paid})` : 'Full refund' },
    { value: 'partial', label: 'Partial refund' },
    { value: 'none', label: 'No refund' },
  ]

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/50"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-2xl p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-accommodation-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="cancel-accommodation-title"
          className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
        >
          Cancel accommodation?
        </h2>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
          Remove{' '}
          <span className="font-medium text-neutral-800 dark:text-neutral-200">{name}</span> from
          this trip. This cannot be undone.
        </p>
        {paidLine}
        <fieldset className="mt-4">
          <legend className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Did you get a refund?
          </legend>
          <div className="mt-2 space-y-2">
            {options.map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 px-3 py-2.5 text-sm text-neutral-800 dark:text-neutral-200 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/80"
              >
                <input
                  type="radio"
                  name="lodging-refund"
                  value={opt.value}
                  checked={refundStatus === opt.value}
                  onChange={() => setRefundStatus(opt.value)}
                  className="accent-rose-600"
                />
                {opt.label}
              </label>
            ))}
          </div>
          {refundStatus === 'partial' ? (
            <input
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              placeholder="Refund amount (for your notes)"
              className="mt-2 w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-600 dark:bg-neutral-950 text-sm"
              autoFocus
            />
          ) : null}
        </fieldset>
        <p className="mt-4 text-xs font-medium text-rose-700 dark:text-rose-400">
          The booking will be deleted permanently from this trip.
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-600 text-sm font-medium text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            Keep booking
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/40"
          >
            Remove permanently
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
