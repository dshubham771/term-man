# Terminal Manager — zsh integration (command capture + prompt markers)
# Loaded by tm-zshrc; do not modify user files.

__tm_osc_prompt() {
  printf '\033]1337;tm-prompt\007'
}

__tm_osc_command() {
  local cmd="$1"
  local encoded
  encoded="$(printf '%s' "$cmd" | base64 | tr -d '\n')"
  printf '\033]1337;tm-cmd;%s\007' "$encoded"
}

__tm_preexec() {
  local cmd="$1"
  __tm_osc_command "$cmd"
}

__tm_precmd() {
  __tm_osc_prompt
}

if [[ -z "${__tm_integration_loaded:-}" ]]; then
  __tm_integration_loaded=1
  preexec_functions+=(__tm_preexec)
  precmd_functions+=(__tm_precmd)
  __tm_osc_prompt
fi
