# Terminal Manager ZDOTDIR bootstrap - keep generated files out of app zdotdir
TM_STATE_DIR="${HOME}/.terminal-manager"
if [[ ! -d "${TM_STATE_DIR}" ]]; then
  mkdir -p "${TM_STATE_DIR}" 2>/dev/null
fi
export ZSH_COMPDUMP="${TM_STATE_DIR}/.zcompdump-${HOST}-${ZSH_VERSION}"

# Chain to the user's ~/.zshenv
if [[ -f "${HOME}/.zshenv" ]]; then
  source "${HOME}/.zshenv"
fi
