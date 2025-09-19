import PropTypes from 'prop-types';
import { useCallback, useMemo, useRef, useState } from 'react';
import ClayLayout from '@clayui/layout';

export default function LeftNav({ items, activeId, onSelect, header }) {
  const [open, setOpen] = useState(true);
  const itemRefs = useRef([]);

  const ids = useMemo(
    () => ({
      nav: 'leftnav-nav',
      list: 'leftnav-list',
      toggler: 'leftnav-toggler',
    }),
    []
  );

  const onKeyDown = useCallback((e) => {
    const focusables = itemRefs.current.filter(Boolean);
    if (!focusables.length) return;
    const idx = focusables.indexOf(document.activeElement);
    let nextIdx = idx;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        nextIdx = idx < 0 ? 0 : Math.min(focusables.length - 1, idx + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        nextIdx = idx < 0 ? 0 : Math.max(0, idx - 1);
        break;
      case 'Home':
        e.preventDefault();
        nextIdx = 0;
        break;
      case 'End':
        e.preventDefault();
        nextIdx = focusables.length - 1;
        break;
      default:
        return;
    }
    focusables[nextIdx]?.focus();
  }, []);

  return (
    <ClayLayout.Col size={3}>
      <div className="c-ml-3">
        {header && <h3 className="mb-3">{header}</h3>}
        <nav id={ids.nav} aria-label="Section navigation">
          <button
            id={ids.toggler}
            className="menubar-toggler btn btn-unstyled"
            type="button"
            aria-expanded={open}
            aria-controls={ids.list}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="inline-item inline-item-before">Menu</span>
            <svg
              focusable="false"
              role="presentation"
              className="lexicon-icon lexicon-icon-caret-bottom"
              aria-hidden="true"
            >
              <use href="/o/admin-theme/images/clay/icons.svg#caret-bottom" />
            </svg>
          </button>

          <div className={`menubar-collapse ${open ? '' : 'collapse'}`}>
            <ul id={ids.list} className="nav nav-nested" onKeyDown={onKeyDown}>
              {items.map((item, i) => {
                const isActive = activeId === item.id;
                return (
                  <li className="nav-item" key={item.id}>
                    <button
                      ref={(el) => (itemRefs.current[i] = el)}
                      type="button"
                      className={`btn btn-unstyled nav-link ${
                        isActive ? 'active' : ''
                      }`}
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => onSelect(item.id)}
                    >
                      {item.icon ? (
                        <span className="inline-item inline-item-before">
                          <svg
                            aria-hidden="true"
                            className={`lexicon-icon lexicon-icon-${item.icon}`}
                          >
                            <use
                              href={`/o/admin-theme/images/clay/icons.svg#${item.icon}`}
                            />
                          </svg>
                        </span>
                      ) : null}
                      <span>{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </nav>
      </div>
    </ClayLayout.Col>
  );
}

LeftNav.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      icon: PropTypes.string,
    })
  ).isRequired,
  activeId: PropTypes.string.isRequired,
  onSelect: PropTypes.func.isRequired,
  header: PropTypes.string,
};
