import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown } from 'lucide-react';

/**
 * Floating jump-to-latest button over the transcript; the violet dot marks
 * messages that arrived while scrolled up.
 */
export function ChatScrollButton({
  visible,
  hasNew,
  onClick,
}: {
  visible: boolean;
  hasNew: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          onClick={onClick}
          title="Scroll to latest"
          aria-label="Scroll to latest"
          className="focus-ring absolute bottom-3 right-3 z-10 p-2 rounded-full bg-surface-800 border border-surface-600 shadow-lg text-surface-300 hover:border-violet-500/50 hover:text-surface-100 transition-colors duration-150"
        >
          <ArrowDown size={14} />
          {hasNew && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-violet-500" />
          )}
        </motion.button>
      )}
    </AnimatePresence>
  );
}
