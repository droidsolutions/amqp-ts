import { expect } from "chai";
import { Message } from "../src/Message";

interface TestInterface {
  propertyA: string;
}

describe("Message", function () {
  describe("getJsonContent", function () {
    it("should throw an error if the content type is not set to application/json", function () {
      const data: TestInterface = { propertyA: "test" };

      const message = new Message(data);
      message.properties.contentType = "application/xml";

      expect(() => message.getJsonContent<TestInterface>()).to.throw(Error);
    });

    it("should return parsed content", function () {
      const data: TestInterface = { propertyA: "test€" };

      const message = new Message(data);

      expect(message.getJsonContent<TestInterface>()).to.deep.equal(data);
    });
  });
});
