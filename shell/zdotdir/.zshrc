# Terminal Manager ZDOTDIR bootstrap - app hooks, then the user's ~/.zshrc
if [[ -n "${TM_ZSH_INTEGRATION:-}" && -f "${TM_ZSH_INTEGRATION}" ]]; then
  source "${TM_ZSH_INTEGRATION}"
fi

if [[ -f "${HOME}/.zshrc" ]]; then
  source "${HOME}/.zshrc"
fi
