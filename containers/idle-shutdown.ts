/** Independent process-level cost guard. An unfinished request never expires. */
export function idleShutdown(onIdle: () => void, timeoutMs = 60000) {
  let active = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => { clearTimeout(timer); timer = setTimeout(onIdle, timeoutMs); };
  arm();
  return {
    begin() {
      active++; clearTimeout(timer);
      let finished = false;
      return () => {
        if (finished) return;
        finished = true; active--;
        if (!active) arm();
      };
    },
    dispose() { clearTimeout(timer); },
  };
}
