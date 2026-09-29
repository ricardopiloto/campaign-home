import Header from '../components/Header'
import PanelsBoard from '../components/PanelsBoard'
import Footer from '../components/Footer'
import { useCampaigns } from '../hooks/useCampaigns'

function HomePage() {
  const { state, retry } = useCampaigns()

  return (
    <div className="page">
      <Header />
      <main className="main">
        <PanelsBoard state={state} onRetry={retry} />
      </main>
      <Footer />
    </div>
  )
}

export default HomePage
