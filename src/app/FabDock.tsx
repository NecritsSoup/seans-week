import { DispatchesFab } from './DispatchesFab';
import { HermesFab } from './HermesFab';

/**
 * The bottom-right stack: the Dispatches wax seal above the Hermes
 * medallion. (The first-run coach mark anchors to the topbar's
 * Dispatches button — see DispatchesButton.)
 */
export function FabDock() {
  return (
    <div className="fab-dock">
      <DispatchesFab />
      <HermesFab />
    </div>
  );
}
