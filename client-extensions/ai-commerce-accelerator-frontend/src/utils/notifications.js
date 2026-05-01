const notifyUser = (message, type = 'success', details) => {
  if (
    typeof Liferay !== 'undefined' &&
    Liferay.Util &&
    Liferay.Util.openToast
  ) {
    Liferay.Util.openToast({
      message: message,
      type: type,
    });
    if (details) {
      switch (type) {
        case 'danger':
          console.error('Details', details);
          break;
        case 'warning':
          console.warn('Details', details);
          break;
        case 'success':
          console.info('Details', details);
          break;
        default:
          console.log('Details', details);
          break;
      }
    }
  } else {
    switch (type) {
      case 'danger':
        if (details) console.error(message, details);
        else console.error(message);
        break;
      case 'warning':
        if (details) console.warn(message, details);
        else console.warn(message);
        break;
      case 'success':
        if (details) console.info(message, details);
        else console.info(message);
        break;
      default:
        if (details) console.log(message, details);
        else console.log(message);
        break;
    }
  }
};

export default notifyUser;
