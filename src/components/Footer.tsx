function Footer() {
  return (
    <footer className="site-footer entrance" style={{ animationDelay: '500ms' }}>
      <div className="site-footer__status">
        <span className="status-dot" aria-hidden="true" />
        <span className="label-mono">GLOBAL SERVER STATUS: OPERATIONAL</span>
      </div>
      <nav className="site-footer__nav" aria-label="Links do rodapé">
        <a className="label-mono" href="#archives">
          ARCHIVES
        </a>
        <a className="label-mono" href="#support">
          SUPPORT
        </a>
        <a
          className="label-mono"
          href="https://foundryvtt.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          FOUNDRY VTT
        </a>
      </nav>
    </footer>
  )
}

export default Footer
