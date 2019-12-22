import minify from "rollup-plugin-babel-minify";
import commonjs from "@rollup/plugin-commonjs";

const dist = 'dist';

export default {
  input: 'src/nonvalid.js',
  plugins: [commonjs()],
  output: [
    {
      file: `${dist}/nonvalid.cjs.js`,
      format: 'cjs'
    },
    {
      file: `${dist}/nonvalid.esm.js`,
      format: 'esm',
    },
    {
      name: 'nonvalid',
      file: `${dist}/nonvalid.js`,
      format: 'umd'
    },
    {
      name: 'nonvalid',
      file: `${dist}/nonvalid.min.js`,
      format: 'umd',
      plugins: [minify()]
    }
  ]
};