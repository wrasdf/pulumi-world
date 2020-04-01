import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as eks from "@pulumi/eks";

const env = pulumi.getStack();

// Allocate a new VPC with the default settings:
const vpc = new awsx.ec2.Vpc(`apollo-${env}`, {
  cidrBlock: "10.30.0.0/16",
  numberOfAvailabilityZones: "all",
  numberOfNatGateways: 3,
  subnets: [
    { type: "public" },
    { type: "private" },
    { type: "isolated", name: "db" }
  ],
});

const privateVpcSubnets = vpc.privateSubnetIds;

// Creates a role and attaches the EKS worker node IAM managed policies. Used a few times below,
// to create multiple roles, so we use a function to avoid repeating ourselves.
export function createRole(name: string): aws.iam.Role {
  const role = new aws.iam.Role(name, {
      assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
          Service: "ec2.amazonaws.com",
      }),
  });

  const managedPolicyArns: string[] = [
    "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
  ];

  let counter = 0;
  for (const policy of managedPolicyArns) {
      // Create RolePolicyAttachment without returning it.
      const rpa = new aws.iam.RolePolicyAttachment(`${name}-policy-${counter++}`,
          { 
            policyArn: policy, 
            role: role 
          },
      );
  }

  return role;
}

const eksNodeRole = createRole("eksNodeRole");
const eksNodeInstanceProfile = new aws.iam.InstanceProfile("eksNodeInstanceProfile", {role: eksNodeRole});

const eksCluster = new eks.Cluster(`apollo-${env}`, {
  version: "1.15",
  vpcId: vpc.id,
  privateSubnetIds: privateVpcSubnets,
  skipDefaultNodeGroup: true,
  instanceRoles: [
    eksNodeRole,
  ],
  tags: {
    Name: "pulumiCluster",
  },
  enabledClusterLogTypes: [
      "api",
      "audit",
      "authenticator",
      "controllerManager",
      "scheduler",
  ],
});

["a","b","c"].forEach( (item, index)=> {
  new eks.NodeGroup(`privateNodeGroup${item}`, {
    cluster: eksCluster,
    version: "1.15",
    instanceType: "m5.large",
    nodeSubnetIds: [privateVpcSubnets[index]],
    nodeRootVolumeSize: 20,
    desiredCapacity: 1,
    minSize: 1,
    maxSize: 5,
    labels: {"role": "node"},
    instanceProfile: eksNodeInstanceProfile,
  }, {
    providers: { kubernetes: eksCluster.provider},
  });
});

export const kubeconfig = eksCluster.kubeconfig;

