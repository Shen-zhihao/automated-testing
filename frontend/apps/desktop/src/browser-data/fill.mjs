// Executed only in the selected page's isolated main-frame world after a user click.
// No submit, iframe traversal, model-generated script, or return of field contents.
export function fillLoginForm({ origin, username, password }) {
  if (location.origin !== origin) throw new Error('网站已变化，未填入密码。');
  const visible = (element) =>
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden' &&
    !element.disabled &&
    !element.readOnly;
  const passwords = [...document.querySelectorAll('input[type="password"]')].filter(visible);
  if (
    passwords.length !== 1 ||
    passwords[0].autocomplete.toLowerCase().split(/\s+/).includes('new-password')
  )
    throw new Error('未找到唯一的登录密码框。请进入登录页；注册、改密及内嵌登录框需手动填写。');
  const target = passwords[0],
    form = target.form;
  const sameSiteForm = () => !form?.action || new URL(form.action, location.href).origin === origin;
  if (!sameSiteForm()) throw new Error('登录表单提交到其他网站，未填入。');
  const inputs = [...(form || document).querySelectorAll('input')].filter(
    (element) => visible(element) && ['text', 'email', 'tel'].includes(element.type),
  );
  const marked = inputs.filter((element) => element.autocomplete.split(/\s+/).includes('username'));
  const users = marked.length ? marked : inputs;
  if (username && users.length > 1) throw new Error('页面有多个账号输入框，请手动填写。');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const fill = (element, value) => {
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (users.length === 1) fill(users[0], username);
  if (location.origin !== origin || !target.isConnected || !sameSiteForm())
    throw new Error('登录页面已变化，请重试。');
  fill(target, password);
  return '已填入，请在网页中确认并登录。';
}
