import PropTypes from 'prop-types';
import ClayLayout from '@clayui/layout';

export default function LeftNav({ items, activeId, onSelect }) {
  return (
    <ClayLayout.Col size={3}>
      <div className="c-ml-3">
        <div className="lfr-tooltip-scope">
          <nav
            className="menubar menubar-transparent menubar-vertical-expand-md"
            aria-label="Section navigation"
          >
            <button className="menubar-toggler btn btn-unstyled" type="button">
              <span className="inline-item inline-item-before">Menu</span>
              <svg
                focusable="false"
                role="presentation"
                className="lexicon-icon lexicon-icon-caret-bottom"
              >
                <use href="/o/admin-theme/images/clay/icons.svg#caret-bottom"></use>
              </svg>
            </button>
            <div className="collapse menubar-collapse">
              <ul
                aria-orientation="vertical"
                role="menubar"
                className="nav nav-nested"
              >
                {items.map((item) => (
                  <li role="none" className="nav-item" key={item.id}>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={activeId === item.id}
                      className={`btn btn-unstyled nav-link ${
                        activeId === item.id ? 'active' : ''
                      }`}
                      onClick={() => onSelect(item.id)}
                    >
                      {item.icon ? (
                        <span className="inline-item inline-item-before">
                          <svg
                            aria-hidden="true"
                            className="lexicon-icon lexicon-icon-${item.icon}"
                          >
                            <use
                              href={`/o/admin-theme/images/clay/icons.svg#${item.icon}`}
                            ></use>
                          </svg>
                        </span>
                      ) : null}
                      <span>{item.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        </div>
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
