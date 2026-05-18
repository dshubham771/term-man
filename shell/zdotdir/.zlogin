# Terminal Manager ZDOTDIR bootstrap - chain to the user's ~/.zlogin (login)
if [[ -f "${HOME}/.zlogin" ]]; then
  source "${HOME}/.zlogin"
fi
