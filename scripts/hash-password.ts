import { hashPassword } from "../lib/password";

// Turns a password into the `passwordHash` value an APP_USERS entry needs,
// so the plaintext never has to be stored anywhere.
//
//   npm run hash-password -- 'the password'
//
// Quote the password. A shell eats $, !, spaces and quotes otherwise, and
// you would end up hashing something other than what you typed.

const password = process.argv[2];

if (!password) {
  console.error("Usage: npm run hash-password -- 'the password'");
  process.exit(1);
}

if (password.length < 12) {
  console.error(`Refusing: that password is ${password.length} characters. Use at least 12, and prefer random ones.`);
  process.exit(1);
}

console.log(hashPassword(password));
