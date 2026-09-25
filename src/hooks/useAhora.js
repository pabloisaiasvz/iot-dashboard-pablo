import { useEffect, useState } from "react";

/** Hora actual que se actualiza cada `cadaMs`: hace que el estado offline
 *  se reevalúe aunque no lleguen datos nuevos. */
export function useAhora(cadaMs = 1000) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setAhora(Date.now()), cadaMs);
    return () => clearInterval(iv);
  }, [cadaMs]);
  return ahora;
}
