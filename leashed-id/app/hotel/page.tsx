import Link from 'next/link'
import HotelFormView from './hotelFormView'

// The hostile third-party form (FR-5). ?reveal=1 highlights the hidden injection for the video.
export default async function HotelPage({ searchParams }: { searchParams: Promise<{ reveal?: string }> }) {
  const revealed = (await searchParams).reveal === '1'

  return (
    <main className="page">
      <p className="eyebrow">Third-party page, published by the hotel</p>
      <h1>Hotel check-in form</h1>
      <p className="lead">
        {revealed
          ? 'Revealed: the hotel hid an instruction for AI assistants, and an extra address field, at the bottom of its form. '
          : 'The form exactly as the hotel publishes it. '}
        <Link href={revealed ? '/hotel' : '/hotel?reveal=1'}>{revealed ? 'Hide it again' : 'Reveal hidden text'}</Link>
      </p>
      <HotelFormView reveal={revealed} />
    </main>
  )
}
