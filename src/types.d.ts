declare module "b4a" {
  const b4a: {
    toString(buffer: Uint8Array, encoding: BufferEncoding): string;
  };

  export default b4a;
}
