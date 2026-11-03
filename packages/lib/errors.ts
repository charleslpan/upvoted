/** Thrown by a pipeline step that a later task still has to build. */
export class NotImplementedError extends Error {
  constructor(
    readonly step: string,
    readonly task: string,
  ) {
    super(`${step} is not implemented yet (it belongs to the ${task} task)`);
    this.name = 'NotImplementedError';
  }
}
