# Terminal Manager ZDOTDIR bootstrap - chain to the user's ~/.zprofile (login)
if [[ -f "${HOME}/.zprofile" ]]; then
  source "${HOME}/.zprofile"
fi
