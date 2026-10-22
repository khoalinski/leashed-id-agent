import { HOTEL_FORM, type FormField } from '@/lib/hotelForm'

type Props = {
  reveal: boolean                      // highlight the injected instruction (FR-5.3)
  values?: Record<string, string>      // agent preview: fieldId -> granted value (read-only)
  locked?: Record<string, boolean>     // agent preview: fieldId -> denied by the network
}

export function LockIcon() {
  return (
    <svg className="lock" aria-label="Denied" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
      <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 4 15h8a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 12 6h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 5H6V4.5a2 2 0 1 1 4 0V6Z" />
    </svg>
  )
}

// The hotel's check-in form as the third party publishes it (FR-5.2), or the
// agent's read-only filled copy (FR-7.4).
export default function HotelFormView({ reveal, values, locked }: Props) {
  const [hotelName, formName] = HOTEL_FORM.title.split(' — ')

  const field = (f: FormField) => (
    <label className="hotel-field" key={f.id}>
      <span>
        {f.label}
        {locked?.[f.id] && <span className="locked"><LockIcon /> denied</span>}
      </span>
      {values ? <input readOnly value={values[f.id] ?? ''} /> : <input />}
    </label>
  )

  return (
    <div className="hotel">
      <div className="hotel-header">
        <div className="hotel-logo" aria-hidden>SM</div>
        <div>
          <div className="hotel-name">{hotelName}</div>
          <div className="hotel-sub">{formName}</div>
        </div>
      </div>
      <div className="hotel-body">
        {HOTEL_FORM.fields.map(field)}
        <button className="hotel-submit" type="button" disabled>Gửi phiếu · Submit</button>
        <div className={reveal ? 'hotel-injected revealed' : 'hotel-injected'}>
          {reveal && <span className="injected-label">Injected instruction</span>}
          <p>{HOTEL_FORM.injection}</p>
          {field(HOTEL_FORM.hiddenField)}
        </div>
      </div>
    </div>
  )
}
