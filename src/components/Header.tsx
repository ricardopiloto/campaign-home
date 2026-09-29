function Header() {
  return (
    <header className="site-header entrance" style={{ animationDelay: '0ms' }}>
      <div className="site-header__title">
        <p className="label-mono">FOUNDRY GATEWAY</p>
        <h1 className="display-title">Active Campaigns</h1>
      </div>
      <p className="site-header__instruction">
        Passe o mouse sobre um mundo para expandi-lo.
        <br />
        Escolha o seu e entre no realm.
      </p>
    </header>
  )
}

export default Header
