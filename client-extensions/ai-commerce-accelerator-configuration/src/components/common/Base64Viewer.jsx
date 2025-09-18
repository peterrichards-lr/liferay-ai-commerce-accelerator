import PropTypes from 'prop-types';

export default function Base64Viewer({
  base64Data,
  mimeType,
  width = '100%',
  height = '600px',
}) {
  if (!base64Data || !mimeType) {
    return <p>No content available.</p>;
  }

  const src = `data:${mimeType};base64,${base64Data}`;

  if (mimeType.startsWith('image/')) {
    return (
      <img
        src={src}
        alt="Base64 content"
        style={{ maxWidth: width, height: 'auto' }}
      />
    );
  }

  if (mimeType === 'application/pdf') {
    return (
      <embed src={src} type="application/pdf" width={width} height={height} />
    );
  }

  return (
    <p>
      Unsupported mimeType: <code>{mimeType}</code>
    </p>
  );
}

Base64Viewer.propTypes = {
  base64Data: PropTypes.string.isRequired,
  mimeType: PropTypes.string.isRequired,
  width: PropTypes.string,
  height: PropTypes.string,
};
